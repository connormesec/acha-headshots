/** "Pick your jersey": the reviewer clicks a few of their own players in a batch; everyone who
 * looks nothing like them (opponents, referees, fans) is *suggested* for hiding, and automatic
 * tags whose jersey doesn't match (an opponent wearing a roster number) are suggested for a second
 * look. Nothing changes until the reviewer confirms. Port of services/jersey_service.py. */

import { SORTING } from "../config";
import { hideThreshold, teamScores } from "../resolution/jerseyMatch";
import { RESOLVED, UNRESOLVED, type Detection } from "../types";
import type { JobView } from "../view";

export const HIDE_REASON = "Not our team: jersey doesn't match the players picked in 'Pick your jersey'";
export const RECHECK_REASON = "Jersey doesn't look like the players picked in 'Pick your jersey'; check this tag";

/** Everyone the reviewer might care about: tagged or undecided people with a crop. Hidden and
 * rejected people are left out. Tagged players first: they're the easiest to recognise as ours. */
export function jobPeople(view: JobView): Detection[] {
  const order = new Map(view.photos.map((p) => [p.id, p.order]));
  return view.detections
    .filter((d) => !d.manual && (RESOLVED.has(d.status) || UNRESOLVED.has(d.status)))
    .sort((a, b) => Number(!RESOLVED.has(a.status)) - Number(!RESOLVED.has(b.status))
      || (order.get(a.photoId) ?? 0) - (order.get(b.photoId) ?? 0) || a.index - b.index);
}

export interface Scored { detection: Detection; score: number }
export interface Suggestion { threshold: number; referenceCount: number; hide: Scored[]; recheck: Scored[]; stillUnresolved: number }

/** `vectors[i]` is the embedding of `people[i]`. */
export function suggest(people: Detection[], vectors: Float32Array[], ours: string[]): Suggestion {
  const index = new Map(people.map((d, i) => [d.id, i]));
  const picked = new Set(ours.filter((id) => index.has(id)));
  const scores = teamScores(vectors, [...picked].map((id) => index.get(id)!).sort((a, b) => a - b));
  // Only the reviewer's picks are examples (a crop can hold two people or be mis-tagged, and one
  // bad example drags every score around); confirmed tags only set the threshold.
  const reference = people.map((d, i) => (picked.has(d.id) || RESOLVED.has(d.status) ? scores[i] : NaN)).filter((s) => !Number.isNaN(s));
  const threshold = hideThreshold(reference, SORTING.jerseyMargin, SORTING.jerseyFallbackThreshold, SORTING.jerseyMinReference);
  const hide: Scored[] = [], recheck: Scored[] = [];
  let still = 0;
  people.forEach((d, i) => {
    if (picked.has(d.id)) return;
    const low = Number.isFinite(scores[i]) && scores[i] < threshold;
    if (UNRESOLVED.has(d.status)) low ? hide.push({ detection: d, score: scores[i] }) : still++;
    else if (d.status === "AUTO_ACCEPTED" && low) recheck.push({ detection: d, score: scores[i] });
  });
  const byScore = (a: Scored, b: Scored) => a.score - b.score; // least similar first
  return { threshold, referenceCount: reference.filter(Number.isFinite).length, hide: hide.sort(byScore), recheck: recheck.sort(byScore), stillUnresolved: still };
}

/** The changed people. Only touches people still in the state the suggestion was made for, so
 * a confirmed tag is never overwritten. */
export function applySuggestion(view: JobView, hide: string[], recheck: string[]): Detection[] {
  const byId = new Map(view.detections.map((d) => [d.id, d]));
  const out: Detection[] = [];
  for (const id of new Set(hide)) {
    const d = byId.get(id);
    if (!d || !UNRESOLVED.has(d.status)) continue;
    out.push({
      ...d, status: "REJECTED", reasoning: `${HIDE_REASON}. ${d.reasoning ?? ""}`.trim().slice(0, 4000),
      matches: d.matches.map((m) => (m.status !== "PROPOSED" ? { ...m, status: "REJECTED" } : m)),
    });
  }
  for (const id of new Set(recheck)) {
    const d = byId.get(id);
    if (!d || d.status !== "AUTO_ACCEPTED") continue;
    out.push({
      ...d, status: "NEEDS_REVIEW", reasoning: `${RECHECK_REASON}. ${d.reasoning ?? ""}`.trim().slice(0, 4000),
      matches: d.matches.map((m) => (m.status === "AUTO_ACCEPTED" ? { ...m, status: "NEEDS_REVIEW" } : m)),
    });
  }
  return out;
}
