/** Background-person filter: spot fans in the stands (and other incidental people) so they don't
 * flood the review queue. Port of processing/subject_filter.py.
 *
 * Photographers frame and focus on the players they shoot. People in the stands are small next
 * to the main subject, sit high in the frame (above the boards) and are out of focus. All three
 * are measured *relative to the other people in the same photo*, so a photo with one person is
 * never filtered. A candidate is only filtered if OCR also found no jersey number, which keeps
 * distant players whose number is readable. On the first real batch this rule removed 71% of
 * non-players and none of the 73 real players. */

import type { Box } from "../../../lib/geometry";

export interface SubjectFeatures {
  relativeHeight: number;    // box height / tallest box in the photo
  relativeSharpness: number; // focus / sharpest person in the photo
  bottom: number;            // bottom edge as a fraction of photo height (0 = top)
}

export interface BackgroundRule { maxRelativeHeight: number; maxRelativeSharpness: number; maxBottom: number }

export function subjectFeatures(boxes: Box[], sharpness: number[], imageHeight: number): SubjectFeatures[] {
  if (!boxes.length) return [];
  const tallest = Math.max(...boxes.map((b) => b.height)) || 1;
  const sharpest = Math.max(...sharpness) || 1;
  return boxes.map((b, i) => ({
    relativeHeight: b.height / tallest,
    relativeSharpness: sharpness[i] / sharpest,
    bottom: (b.y + b.height) / Math.max(imageHeight, 1),
  }));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Why this person looks like background. Empty if they look like a subject. */
export function backgroundReasons(f: SubjectFeatures, rule: BackgroundRule): string[] {
  if (f.relativeHeight >= rule.maxRelativeHeight) return [];
  const reasons = [`small (${pct(f.relativeHeight)} of the main subject's height)`];
  if (f.relativeSharpness < rule.maxRelativeSharpness) reasons.push(`out of focus (${pct(f.relativeSharpness)} of the sharpest person)`);
  if (f.bottom < rule.maxBottom) reasons.push("high in the frame (stands)");
  return reasons.length > 1 ? reasons : [];
}
