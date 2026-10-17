/** Boxes and crops shared by every tool. */

export interface Box { x: number; y: number; width: number; height: number }   // pixels
export interface Crop { x: number; y: number; w: number; h: number }           // fractions (0..1) of the image

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Pixel rectangle with an exact `aspect` (width / height). */
export function cropPixels(c: Crop, imgW: number, imgH: number, aspect: number) {
  let width = Math.max(2, Math.round(c.w * imgW));
  let height = Math.round(width / aspect);
  if (height > imgH) { height = imgH; width = Math.max(2, Math.round(height * aspect)); } // rounding on a full-height crop
  const left = clamp(Math.round(c.x * imgW), 0, Math.max(0, imgW - width));
  const top = clamp(Math.round(c.y * imgH), 0, Math.max(0, imgH - height));
  return { left, top, width, height };
}

/** User edits: force `aspect` (height follows width) and keep inside the image. */
export function normalizeCrop(x: number, y: number, w: number, imgW: number, imgH: number, aspect: number): Crop {
  w = clamp(w, 0.02, 1);
  let h = (w * imgW) / aspect / imgH;
  if (h > 1) { const cx = x + w / 2; w = w / h; h = 1; x = cx - w / 2; }
  return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
}
