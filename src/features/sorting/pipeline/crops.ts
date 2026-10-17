/** Crop geometry for a detected player. Port of processing/crops.py (tuned for upright skaters). */

import type { Box } from "../../../lib/geometry";

export function clampBox(x: number, y: number, w: number, h: number, imgW: number, imgH: number): Box {
  const x0 = Math.max(0, Math.trunc(x)), y0 = Math.max(0, Math.trunc(y));
  const x1 = Math.min(imgW, Math.trunc(x + w)), y1 = Math.min(imgH, Math.trunc(y + h));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** The whole player with a little room around them (what reviewers and the vision model see). */
export function paddedBox(b: Box, imgW: number, imgH: number, pad = 0.08): Box {
  const px = Math.trunc(b.width * pad), py = Math.trunc(b.height * pad);
  return clampBox(b.x - px, b.y - py, b.width + 2 * px, b.height + 2 * py, imgW, imgH);
}

/** Head, shoulders, torso: top ~60% of the player (sleeve and shoulder numbers). */
export const upperBodyBox = (b: Box, imgW: number, imgH: number) => clampBox(b.x, b.y, b.width, b.height * 0.6, imgW, imgH);

/** Where back/front numbers usually sit: 15-60% of height, central 80% of width. */
export const jerseyBox = (b: Box, imgW: number, imgH: number) =>
  clampBox(b.x + Math.trunc(b.width * 0.1), b.y + Math.trunc(b.height * 0.15), Math.trunc(b.width * 0.8), Math.trunc(b.height * 0.45), imgW, imgH);
