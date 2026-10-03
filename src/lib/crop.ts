/** Headshot framing for ACHA (2:3 portrait, rendered at 1000x1500). Pure functions.
 * Port of backend/app/processing/headshot_crop.py from Puck Press Photo AI.
 *
 * Crops are fractions (0..1) of the image, so one box applies to the downscaled preview the
 * user edits and to the full-size original we render from. */

export type Flag = "not_headshot" | "no_face" | "multiple_people" | "small_face" | "low_resolution" | "upscaled" | "generic_name";
export interface Box { x: number; y: number; width: number; height: number }   // pixels
export interface Crop { x: number; y: number; w: number; h: number }           // fractions
export interface Assessment { crop: Crop; source: "face" | "person" | "center"; flags: Flag[]; faces: Crop[] }

export const ASPECT = 2 / 3; // width / height
// Framing. Tune against real headshots (docs/SPEC.md §12). HEAD_ABOVE_FACE was tuned for Haar
// boxes, which start near the eyebrows; BlazeFace boxes start higher, so expect ~0.2–0.3.
export const FACE_FRACTION = 0.32;      // face box height / crop height
export const HEAD_ABOVE_FACE = 0.35;    // top of head is this many face-heights above the box
export const HEAD_TOP_MARGIN = 0.10;    // space above the head, fraction of crop height
export const PERSON_FACE_WIDTH = 0.38;  // with no face, guess face width from the person box
export const PERSON_FACE_MAX_HEIGHT = 0.20; // ... capped for full-body boxes
export const MIN_FACE_FRACTION = 0.04;  // faces smaller than this share of the short side are ignored
export const SMALL_FACE_FRACTION = 0.08; // face height under this share of image height -> flagged
export const SECOND_FACE_RATIO = 0.5;   // a second face at least half the area of the first -> group photo
export const LOW_RES_PX = 600;          // crop width on the original: needs a human look
export const UPSCALE_PX = 1000;         // soft hint: will be upscaled
export const SOFT_FLAGS = new Set<Flag>(["generic_name", "upscaled"]);   // never "needs a look"

const GENERIC_NAME = /^(img|dsc|dscn|dscf|dcim|photo|image|pxl|screenshot|untitled|picture|pic|mvimg|file)[\W_]*\d*/i;
export const isGenericName = (filename: string) => GENERIC_NAME.test(filename);

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const area = (b: Box) => b.width * b.height;

/** Build a 2:3 box in pixels, then move/shrink it to fit inside the image. */
function fit(cx: number, top: number, cropH: number, imgW: number, imgH: number, anchorTop?: number): Crop {
  let cropW = cropH * ASPECT;
  const scale = Math.min(1, imgW / cropW, imgH / cropH);
  if (scale < 1) {
    cropW *= scale;
    cropH *= scale;
    if (anchorTop !== undefined) top = anchorTop - HEAD_TOP_MARGIN * cropH; // same space above the head
  }
  const left = Math.min(Math.max(0, cx - cropW / 2), imgW - cropW);
  top = Math.min(Math.max(0, top), imgH - cropH);
  return { x: left / imgW, y: top / imgH, w: cropW / imgW, h: cropH / imgH };
}

export function frameFace(face: Box, imgW: number, imgH: number): Crop {
  const cropH = face.height / FACE_FRACTION;
  const headTop = face.y - HEAD_ABOVE_FACE * face.height;
  return fit(face.x + face.width / 2, headTop - HEAD_TOP_MARGIN * cropH, cropH, imgW, imgH, headTop);
}

export function framePerson(p: Box, imgW: number, imgH: number): Crop {
  const size = Math.max(1, Math.min(p.width * PERSON_FACE_WIDTH, p.height * PERSON_FACE_MAX_HEIGHT));
  return frameFace(
    { x: Math.round(p.x + p.width / 2 - size / 2), y: Math.round(p.y + HEAD_ABOVE_FACE * size),
      width: Math.round(size), height: Math.round(size) },
    imgW, imgH,
  );
}

/** Largest 2:3 box, centred horizontally, aligned to the top. */
export const frameCenter = (imgW: number, imgH: number) => fit(imgW / 2, 0, imgH, imgW, imgH);

/** User edits: force 2:3 (height follows width) and keep inside the image. */
export function normalizeCrop(x: number, y: number, w: number, imgW: number, imgH: number): Crop {
  w = clamp(w, 0.02, 1);
  let h = (w * imgW) / ASPECT / imgH;
  if (h > 1) { const cx = x + w / 2; w = w / h; h = 1; x = cx - w / 2; }
  return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
}

/** Pixel rectangle with an exact 2:3 ratio. */
export function cropPixels(c: Crop, imgW: number, imgH: number) {
  let width = Math.max(2, Math.round(c.w * imgW));
  let height = Math.round(width / ASPECT);
  if (height > imgH) { height = imgH; width = Math.max(2, Math.round(height * ASPECT)); } // rounding on a full-height crop
  const left = clamp(Math.round(c.x * imgW), 0, Math.max(0, imgW - width));
  const top = clamp(Math.round(c.y * imgH), 0, Math.max(0, imgH - height));
  return { left, top, width, height };
}

const inside = (f: Box, p: Box) => {
  const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
  return p.x <= cx && cx <= p.x + p.width && p.y <= cy && cy <= p.y + p.height;
};
/** `sorted` largest first: is the runner-up big enough to be a second subject? */
const twoSubjects = (sorted: Box[]) => sorted.length > 1 && area(sorted[1]) >= SECOND_FACE_RATIO * area(sorted[0]);

/** Drop tiny faces and faces outside every person (false positives). Largest first. */
export function usableFaces(faces: Box[], persons: Box[], imgW: number, imgH: number): Box[] {
  const minSide = MIN_FACE_FRACTION * Math.min(imgW, imgH);
  let kept = faces.filter((f) => f.height >= minSide);
  if (persons.length) kept = kept.filter((f) => persons.some((p) => inside(f, p)));
  return kept.sort((a, b) => area(b) - area(a));
}

/** Pick the auto crop and flag anything a human should look at. Never throws. */
export function assess(faces: Box[], persons: Box[], imgW: number, imgH: number): Assessment {
  persons = [...persons].sort((a, b) => area(b) - area(a));
  const good = usableFaces(faces, persons, imgW, imgH);
  const asFrac = good.map((f) => ({ x: f.x / imgW, y: f.y / imgH, w: f.width / imgW, h: f.height / imgH }));
  const flags: Flag[] = [];
  if (good.length) {
    if (twoSubjects(good) || twoSubjects(persons)) flags.push("multiple_people");
    if (good[0].height < SMALL_FACE_FRACTION * imgH) flags.push("small_face");
    return { crop: frameFace(good[0], imgW, imgH), source: "face", flags, faces: asFrac };
  }
  if (persons.length) {
    flags.push("no_face");
    if (twoSubjects(persons)) flags.push("multiple_people");
    return { crop: framePerson(persons[0], imgW, imgH), source: "person", flags, faces: asFrac };
  }
  flags.push("not_headshot");
  return { crop: frameCenter(imgW, imgH), source: "center", flags, faces: asFrac };
}

export function resolutionFlags(crop: Crop, originalW: number): Flag[] {
  const px = crop.w * originalW;
  return px < LOW_RES_PX ? ["low_resolution"] : px < UPSCALE_PX ? ["upscaled"] : [];
}
