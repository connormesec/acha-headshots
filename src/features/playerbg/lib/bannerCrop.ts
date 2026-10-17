/** Player page background framing (wide 1080x440 banner). Pure functions.
 * Port of processing/banner_crop.py.
 *
 * The goal is an action shot, not a cutout: the player fills about SUBJECT_HEIGHT_FRACTION of
 * the banner height, and people right next to them (the battle, the defender, the puck carrier)
 * are pulled into frame as context. Crops are fractions of the image, like headshot crops, so
 * the same box applies to the normalized preview and the full-resolution original. */

import { clamp, type Box, type Crop } from "../../../lib/geometry";
import type { BgFlag } from "../../sorting/types";

export const BG_WIDTH = 1080, BG_HEIGHT = 440, BG_MAX_BYTES = 250_000;
export const BANNER_ASPECT = BG_WIDTH / BG_HEIGHT; // width / height

// Framing
const SUBJECT_HEIGHT_FRACTION = 0.7; // player box height / crop height
const HEADROOM = 0.08;               // space above the player's head, fraction of crop height
const CONTEXT_MARGIN = 0.06;         // minimum space around the context group, fraction of crop height
const CONTEXT_GAP = 1.0;             // neighbours within this many player-widths join the context group
const CONTEXT_MIN_HEIGHT = 0.5;      // ... if at least this tall relative to the player (not background)
const CONTEXT_MAX_GROW = 1.6;        // context never zooms the crop out past this much of the plain framing

// Flags. Legs leaving the bottom of a wide banner is normal for close action shots, so "cut off"
// only means the head/upper body (top UPPER_BODY of the box) or a side is lost.
const UPPER_BODY = 0.45;
const CUT_OFF_TOLERANCE = 0.03; // share of the upper body allowed outside the crop
const SIDE_TOLERANCE = 0.1;     // share of the player's width allowed outside the crop
const CROWDED_PEOPLE = 3;       // this many other big people in frame -> crowded
const LOW_RES_PX = 720;         // crop width on the original
const UPSCALE_PX = 1080;

// Score weights (sum to 1) and flag penalties. Tune against real games.
const W_FILL = 0.3, W_SHARP = 0.25, W_MATCH = 0.1, W_RES = 0.15;
const W_PROMINENT = 0.2; // the player, not someone else, is the biggest person in frame
const FILL_SWEET: [number, number] = [0.55, 0.85]; // visible player height / crop height
const PENALTY: Record<BgFlag, number> = { cut_off: 0.35, low_resolution: 0.3, crowded: 0.1, upscaled: 0.05 };

export interface BannerFrame {
  crop: Crop;
  flags: BgFlag[];
  fill: number;       // visible player height / crop height
  prominence: number; // player's visible area / the biggest other person's (capped at 1)
  context: number;    // neighbours pulled into frame
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function union(boxes: Box[]) {
  return {
    left: Math.min(...boxes.map((b) => b.x)), top: Math.min(...boxes.map((b) => b.y)),
    right: Math.max(...boxes.map((b) => b.x + b.width)), bottom: Math.max(...boxes.map((b) => b.y + b.height)),
  };
}
const verticalOverlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) / Math.max(1, Math.min(a.height, b.height));
const horizontalGap = (a: Box, b: Box) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));

/** Foreground people next to the player: big enough, level with them and close by. */
export const contextBoxes = (player: Box, others: Box[]) => others.filter((o) =>
  o.height >= CONTEXT_MIN_HEIGHT * player.height && verticalOverlap(player, o) >= 0.3 && horizontalGap(player, o) <= CONTEXT_GAP * player.width);

const intersectionH = (b: Box, top: number, bottom: number) => Math.max(0, Math.min(b.y + b.height, bottom) - Math.max(b.y, top));
function shareInside(b: Box, left: number, top: number, right: number, bottom: number) {
  const w = Math.max(0, Math.min(b.x + b.width, right) - Math.max(b.x, left));
  return (w * intersectionH(b, top, bottom)) / Math.max(1, b.width * b.height);
}

/** The banner crop for `player` (pixel boxes on an imgW x imgH image). Never fails. */
export function frameAction(player: Box, others: Box[], imgW: number, imgH: number, aspect = BANNER_ASPECT): BannerFrame {
  const context = contextBoxes(player, others);
  const baseH = player.height / SUBJECT_HEIGHT_FRACTION;
  let cropH = baseH, cx: number, groupTop: number;
  if (context.length) {
    const u = union([player, ...context]);
    // Grow (within limits) so the whole group fits with a little air around it.
    const needH = (u.bottom - u.top) * (1 + 2 * CONTEXT_MARGIN) + HEADROOM * cropH;
    const needW = (u.right - u.left) * (1 + (2 * CONTEXT_MARGIN) / aspect);
    cropH = Math.min(Math.max(cropH, needH, needW / aspect), baseH * CONTEXT_MAX_GROW);
    cx = (u.left + u.right) / 2;
    groupTop = u.top;
  } else {
    cx = player.x + player.width / 2;
    groupTop = player.y;
  }
  let cropW = cropH * aspect;
  const scale = Math.min(1, imgW / cropW, imgH / cropH);
  cropW *= scale;
  cropH *= scale;
  // Headroom above the highest head; if the crop got shorter than the player, this keeps the head
  // and upper body (the interesting part) rather than the skates.
  const top = clamp(groupTop - HEADROOM * cropH, 0, imgH - cropH);
  const left = clamp(cx - cropW / 2, 0, imgW - cropW);
  const frame = assessCrop(player, others, { x: left / imgW, y: top / imgH, w: cropW / imgW, h: cropH / imgH }, imgW, imgH);
  return { ...frame, context: context.length };
}

/** Flags and fill for any banner crop (automatic or edited by hand). */
export function assessCrop(player: Box, others: Box[], crop: Crop, imgW: number, imgH: number): BannerFrame {
  const left = crop.x * imgW, top = crop.y * imgH, cropW = crop.w * imgW, cropH = crop.h * imgH;
  const right = left + cropW, bottom = top + cropH;
  const flags: BgFlag[] = [];
  const upper: Box = { x: player.x, y: player.y, width: player.width, height: Math.max(1, Math.round(player.height * UPPER_BODY)) };
  const side = Math.max(0, Math.min(player.x + player.width, right) - Math.max(player.x, left)) / Math.max(1, player.width);
  if (shareInside(upper, left, top, right, bottom) < 1 - CUT_OFF_TOLERANCE || side < 1 - SIDE_TOLERANCE) flags.push("cut_off");
  const bigOthers = others.filter((o) => o.height >= 0.6 * player.height && shareInside(o, left, top, right, bottom) >= 0.5);
  if (bigOthers.length >= CROWDED_PEOPLE) flags.push("crowded");
  const fill = intersectionH(player, top, bottom) / Math.max(cropH, 1);
  const visible = (b: Box) => shareInside(b, left, top, right, bottom) * b.width * b.height;
  const biggestOther = Math.max(0, ...others.map(visible));
  const prominence = biggestOther <= 0 ? 1 : Math.min(1, visible(player) / biggestOther);
  return { crop, flags, fill: r4(fill), prominence: r4(prominence), context: 0 };
}

export function resolutionFlags(crop: Crop, originalW: number): BgFlag[] {
  const px = crop.w * originalW;
  return px < LOW_RES_PX ? ["low_resolution"] : px < UPSCALE_PX ? ["upscaled"] : [];
}

function fillScore(fill: number) {
  const [lo, hi] = FILL_SWEET;
  if (fill < lo) return Math.max(0, fill / lo);
  if (fill > hi) return Math.max(0, 1 - (fill - hi) / (1 - hi + 1e-6));
  return 1;
}

/** 0..1. `relativeSharpness`: this shot's sharpness / the player's sharpest shot; `cropPx`: the
 * crop width on the original. */
export function candidateScore(fill: number, relativeSharpness: number, matchScore: number, cropPx: number, flags: BgFlag[], prominence = 1): number {
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  let score = W_FILL * fillScore(fill) + W_PROMINENT * unit(prominence) + W_SHARP * unit(relativeSharpness)
    + W_MATCH * unit(matchScore) + W_RES * Math.min(1, cropPx / UPSCALE_PX);
  score -= flags.reduce((t, f) => t + (PENALTY[f] ?? 0), 0);
  return r4(Math.max(0, score));
}

/** `Max Haims` -> `max-haims`; accents stripped, anything else becomes a hyphen. */
export function slug(firstName: string, lastName: string, displayName = ""): string {
  const name = `${firstName} ${lastName}`.trim() || displayName;
  const ascii = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "player";
}
