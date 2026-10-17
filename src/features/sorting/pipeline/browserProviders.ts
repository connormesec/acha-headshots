/** The sorting pipeline's providers in the browser: decoding and canvases, MediaPipe for people,
 * the local number reader, and (for admins who turned it on) AI help through our server.
 *
 * Add ?mockcv to the page address (before the #) to use the filename-driven mocks instead of the
 * models: free and instant, for trying the flow and for the e2e tests. */

import { drawRegion, drawScaled, toJpeg } from "../../../lib/canvas";
import { decodeImage } from "../../../lib/decode";
import { detectPeople, loadPersonDetector } from "../../../ml/mediapipe";
import { loadOcr, readJerseyNumbers } from "../../../ml/ocr";
import type { RGBAImage } from "../../../ml/ocr/image";
import { SORTING } from "../config";
import { mockDetect, mockGoalieProbability, mockReadNumbers, type Prepared, type Providers, type VisionClient } from "./providers";

export const MOCK_CV = typeof location !== "undefined" && new URLSearchParams(location.search).has("mockcv");

const CROP_MAX_SIDE = 480; // stored crops: review thumbnails and appearance embeddings

async function prepare(original: Blob): Promise<Prepared> {
  const bmp = await decodeImage(original);
  const originalWidth = bmp.width, originalHeight = bmp.height;
  let canvas: HTMLCanvasElement;
  try {
    canvas = drawScaled(bmp, SORTING.normalizedMaxSide);
  } finally {
    bmp.close(); // never keep full-size bitmaps around: phones run out of memory
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const s = Math.min(1, SORTING.thumbnailMaxSide / Math.max(canvas.width, canvas.height));
  const thumb = drawRegion(canvas, 0, 0, canvas.width, canvas.height, Math.round(canvas.width * s), Math.round(canvas.height * s));
  const [normalizedJpeg, thumbJpeg] = await Promise.all([toJpeg(canvas, 0.85), toJpeg(thumb, 0.8)]);
  thumb.width = thumb.height = 0;
  return {
    rgba: { data, width: canvas.width, height: canvas.height }, canvas, normalizedJpeg, thumbJpeg, originalWidth, originalHeight,
    dispose: () => { canvas.width = canvas.height = 0; },
  };
}

export async function encodeCrop(img: RGBAImage): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const s = Math.min(1, CROP_MAX_SIDE / Math.max(img.width, img.height));
  const out = s < 1 ? drawRegion(c, 0, 0, img.width, img.height, Math.round(img.width * s), Math.round(img.height * s)) : c;
  try {
    return await toJpeg(out, 0.85);
  } finally {
    c.width = c.height = 0;
    out.width = out.height = 0;
  }
}

/** Download the models now, so a problem shows before the job starts. */
export async function warmUp(): Promise<void> {
  if (MOCK_CV) return;
  await Promise.all([loadPersonDetector(), loadOcr()]);
}

export function browserProviders(opts: { vision: VisionClient | null; goalie: boolean }): Providers {
  if (MOCK_CV) {
    return {
      name: "mock", prepare, encodeCrop, vision: opts.vision,
      detect: async (prepared, filename) => mockDetect(prepared, filename),
      readNumbers: async (_crops, ctx) => mockReadNumbers(ctx),
      goalieProbability: opts.goalie ? async (_crops, ctx) => mockGoalieProbability(ctx) : null,
    };
  }
  return {
    name: "browser", prepare, encodeCrop, vision: opts.vision,
    detect: (prepared) => detectPeople(prepared.canvas!),
    readNumbers: async (crops) =>
      (await readJerseyNumbers(crops.jersey, crops.upper)).map((r) => ({ number: r.number, confidence: r.confidence, source: "OCR" as const, region: r.region })),
    goalieProbability: null, // set up in goalie.ts once enabled
  };
}
