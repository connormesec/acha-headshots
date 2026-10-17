/** Jersey-number reader: PP-OCRv6 (small) text detection + recognition, digits only.
 * Replaces providers/ocr/easyocr_provider.py with the same contract: read the jersey and
 * upper-body crops, in two contrast variants, and return every plausible 0-99 number with its
 * best confidence per region, best first. Environment-agnostic: the caller supplies `run`. */

import { contrastGray, crop, resize, rotate90, scaleTo, type RGBAImage } from "./image";

export interface Tensor { data: Float32Array; dims: readonly number[] }
export type RunModel = (model: "det" | "rec", input: Tensor) => Promise<Tensor>;

export interface NumberReading { number: number; confidence: number; region: string }

// Detection (PP-OCRv6 DBPostProcess settings from inference.yml)
const DET_SIDE = 320;          // shorter side fed to the detector, rounded to a multiple of 32
const DET_MAX_SIDE = 960;
const DET_THRESH = 0.2;
const BOX_THRESH = 0.45;
const UNCLIP_RATIO = 1.4;
const DET_MEAN = [0.485, 0.456, 0.406], DET_STD = [0.229, 0.224, 0.225];
// Recognition
const REC_H = 48;
const REC_MAX_W = 320;
const DIGIT_CLASS_0 = 33;      // CTC class of '0' (class 0 is blank; '0'..'9' are 33..42)
export const MIN_TEXT_HEIGHT = 0.08; // of the crop's height (port of min_text_height_fraction)
const MIN_CROP_SIDE = 8;
const SMALL_CROP_H = 160;      // smaller crops are upscaled first: tiny digits read badly

/** Accept 1-2 digit numbers 0-99; reject leading-zero pairs like '07' (OCR noise). Port of
 * ocr/base.parse_jersey_number. */
export function parseJerseyNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  if (t.length === 2 && t[0] === "0" && t !== "00") return null;
  return Number(t);
}

/** Image -> NCHW float tensor, channels in BGR order like PaddleOCR. */
function toTensor(img: RGBAImage, mean: number[], std: number[], width = img.width): Tensor {
  const { height: h } = img;
  const plane = h * width;
  const data = new Float32Array(3 * plane); // padding stays 0 (the mean after normalising)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4, o = y * width + x;
      data[o] = (img.data[i + 2] / 255 - mean[0]) / std[0];
      data[plane + o] = (img.data[i + 1] / 255 - mean[1]) / std[1];
      data[2 * plane + o] = (img.data[i] / 255 - mean[2]) / std[2];
    }
  }
  return { data, dims: [1, 3, h, width] };
}

interface TextBox { x: number; y: number; w: number; h: number; score: number }

/** Text boxes in `img` pixels (axis-aligned; jersey numbers are close to upright). */
export async function detectText(img: RGBAImage, run: RunModel): Promise<TextBox[]> {
  const scale = Math.min(DET_SIDE / Math.min(img.width, img.height), DET_MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(32, Math.round((img.width * scale) / 32) * 32), h = Math.max(32, Math.round((img.height * scale) / 32) * 32);
  const out = await run("det", toTensor(resize(img, w, h), DET_MEAN, DET_STD));
  const mh = out.dims[2], mw = out.dims[3];
  const prob = out.data;
  const seen = new Uint8Array(mw * mh);
  const boxes: TextBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mw * mh; start++) {
    if (seen[start] || prob[start] <= DET_THRESH) continue;
    // Flood fill one connected region of "text" pixels.
    let x0 = mw, y0 = mh, x1 = -1, y1 = -1, sum = 0, n = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % mw, py = (p - px) / mw;
      sum += prob[p]; n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (const q of [p - 1, p + 1, p - mw, p + mw]) {
        if (q < 0 || q >= mw * mh || seen[q] || prob[q] <= DET_THRESH) continue;
        if ((q === p - 1 && px === 0) || (q === p + 1 && px === mw - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const score = sum / n;
    if (Math.min(bw, bh) < 3 || score < BOX_THRESH) continue;
    // "Unclip": the detector marks a shrunken text core; grow it back like DB does.
    const d = (bw * bh * UNCLIP_RATIO) / (2 * (bw + bh));
    const sx = img.width / mw, sy = img.height / mh;
    const bx = Math.max(0, (x0 - d) * sx), by = Math.max(0, (y0 - d) * sy);
    boxes.push({
      x: bx, y: by,
      w: Math.min(img.width, (x1 + 1 + d) * sx) - bx,
      h: Math.min(img.height, (y1 + 1 + d) * sy) - by,
      score,
    });
  }
  return boxes;
}

/** CTC decode limited to digits: at each step the best of blank and '0'..'9', scored by its raw
 * probability (so text that is clearly letters scores low instead of being forced into digits). */
export function decodeDigits(probs: Float32Array, steps: number, classes: number): { text: string; confidence: number } {
  let text = "", last = -1, total = 0, count = 0;
  for (let t = 0; t < steps; t++) {
    const row = t * classes;
    let best = 0, bestP = probs[row]; // blank
    for (let d = 0; d < 10; d++) {
      const p = probs[row + DIGIT_CLASS_0 + d];
      if (p > bestP) { bestP = p; best = d + 1; }
    }
    if (best !== 0 && best !== last) {
      text += String(best - 1);
      total += bestP;
      count++;
    }
    last = best;
  }
  return { text, confidence: count ? total / count : 0 };
}

export async function recognize(img: RGBAImage, run: RunModel): Promise<{ text: string; confidence: number }> {
  const w = Math.min(REC_MAX_W, Math.max(8, Math.ceil((REC_H * img.width) / img.height)));
  const input = toTensor(scaleTo(img, w, REC_H), [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], Math.max(w, 64));
  const out = await run("rec", input);
  return decodeDigits(out.data, out.dims[1], out.dims[2]);
}

/** Wide-set digits come out of the detector as separate boxes: join boxes on one line that are
 * close together. Returns groups of indexes into `boxes` (singletons included). */
export function lineGroups(boxes: TextBox[]): number[][] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      const similar = Math.min(a.h, b.h) >= 0.6 * Math.max(a.h, b.h);
      if (similar && overlap >= 0.5 * Math.min(a.h, b.h) && gap <= 0.8 * Math.max(a.h, b.h)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  boxes.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()];
}

const union = (bs: TextBox[]): TextBox => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y, score: Math.max(...bs.map((b) => b.score)) };
};

/** The best number in one text box. Tall boxes are usually sleeve numbers turned sideways, so
 * they are also read after a quarter turn either way. */
async function readBox(img: RGBAImage, box: TextBox, run: RunModel): Promise<{ number: number; confidence: number } | null> {
  const piece = crop(img, box.x, box.y, box.w, box.h);
  const views = box.h > 1.2 * box.w ? [piece, rotate90(piece, true), rotate90(piece, false)] : [piece];
  let best: { number: number; confidence: number } | null = null;
  for (const view of views) {
    const { text, confidence } = await recognize(view, run);
    const number = parseJerseyNumber(text);
    if (number !== null && (!best || confidence > best.confidence)) best = { number, confidence };
  }
  return best;
}

/** The recognizer's raw confidence runs high: on real games, reads at 0.90 were right 71% of the
 * time and at 0.95, 79% (EasyOCR at 0.90: 41%). This maps it onto the scale the resolver's
 * thresholds were tuned for, so only raw ≥ 0.95 can be auto-accepted (≥ 0.90) and 0.90-0.95
 * goes to review. Measured with scripts/eval-ocr.ts. */
export const calibrate = (raw: number) => Math.round(Math.min(1, Math.max(0, (raw - 0.5) * 2)) * 1e4) / 1e4;

/** Readings for one person: `regions` are e.g. the jersey and upper-body crops. */
export async function readNumbers(regions: { region: string; image: RGBAImage }[], run: RunModel): Promise<NumberReading[]> {
  const best = new Map<string, NumberReading>();
  for (const { region, image } of regions) {
    if (Math.min(image.width, image.height) < MIN_CROP_SIDE) continue;
    let base = image;
    if (base.height < SMALL_CROP_H) {
      const s = SMALL_CROP_H / base.height;
      base = resize(base, Math.round(base.width * s), SMALL_CROP_H);
    }
    // Contrast-stretched gray only. On real games an extra inverted pass (EasyOCR's trick) found 4
    // more numbers but added 13 wrong ones, and doubled the time.
    for (const variant of [contrastGray(base, false)]) {
      const minH = MIN_TEXT_HEIGHT * variant.height;
      const boxes = (await detectText(variant, run)).filter((b) => Math.max(b.h, b.w) >= minH);
      for (const group of lineGroups(boxes)) {
        // A two-digit read of the joined line wins over reads of its single digits.
        const joined = group.length > 1 ? await readBox(variant, union(group.map((i) => boxes[i])), run) : null;
        const reads = joined && joined.number >= 10 ? [joined] : await Promise.all(group.map((i) => readBox(variant, boxes[i], run)));
        for (const read of reads) {
          if (!read) continue;
          const key = `${read.number}:${region}`;
          const prev = best.get(key);
          if (!prev || read.confidence > prev.confidence) {
            best.set(key, { number: read.number, confidence: Math.round(Math.min(1, read.confidence) * 1e4) / 1e4, region });
          }
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}
