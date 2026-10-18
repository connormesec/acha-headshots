/** Player page backgrounds: one wide action shot per identified player. Port of
 * services/player_bg_service.py.
 *
 * Candidates are every person the sorting accepted for a player (auto-accepted or confirmed in
 * review). Picks are reconciled whenever the page opens (`syncPicks`) so review changes flow
 * through: a pick whose person is no longer accepted is re-picked, automatic picks follow the best
 * score, and a human choice or crop edit is kept. */

import { normalizeCrop, type Box, type Crop } from "../../../lib/geometry";
import { acceptedMatch, type BgPick, type Detection, type Match, type Photo } from "../../sorting/types";
import { byPhoto } from "../../sorting/services/stats";
import type { JobView } from "../../sorting/view";
import { assessCrop, BANNER_ASPECT, candidateScore, frameAction, resolutionFlags, type BannerFrame } from "./bannerCrop";

export interface Candidate { detection: Detection; photo: Photo; match: Match; frame: BannerFrame; score: number }

const others = (people: Detection[], d: Detection): Box[] => people.filter((o) => o.id !== d.id && o.status !== "FILTERED" && !o.manual).map((o) => o.box);

function frame(photo: Photo, people: Detection[], d: Detection, crop?: Crop): BannerFrame {
  const w = photo.width ?? 1, h = photo.height ?? 1;
  const f = crop ? assessCrop(d.box, others(people, d), crop, w, h) : frameAction(d.box, others(people, d), w, h, BANNER_ASPECT);
  return { ...f, flags: [...f.flags, ...resolutionFlags(f.crop, photo.originalWidth ?? w)] };
}

/** Every accepted person, framed and scored, grouped by player (best first). */
export function collectCandidates(view: JobView): Map<string, Candidate[]> {
  const people = byPhoto(view.detections);
  const out = new Map<string, Candidate[]>();
  for (const photo of view.photos) {
    if (photo.status !== "PROCESSED" || !photo.width || !photo.height) continue;
    const ds = people.get(photo.id) ?? [];
    for (const d of ds) {
      const m = acceptedMatch(d);
      if (!m || d.manual || !view.players.has(m.playerId)) continue;
      out.set(m.playerId, [...(out.get(m.playerId) ?? []), { detection: d, photo, match: m, frame: frame(photo, ds, d), score: 0 }]);
    }
  }
  for (const cands of out.values()) {
    const sharpest = Math.max(...cands.map((c) => c.detection.sharpness ?? 0)) || 1;
    for (const c of cands) {
      c.score = candidateScore(c.frame.fill, (c.detection.sharpness ?? 0) / sharpest, c.match.finalScore,
        c.frame.crop.w * (c.photo.originalWidth ?? c.photo.width ?? 0), c.frame.flags, c.frame.prominence);
    }
    cands.sort((a, b) => b.score - a.score);
  }
  return out;
}

const fromCandidate = (pick: BgPick, c: Candidate): BgPick => ({
  ...pick, detectionId: c.detection.id, crop: c.frame.crop, autoCrop: c.frame.crop, cropEdited: false,
  flags: [...c.frame.flags], score: c.score, outputBytes: null,
});

/** Exactly one pick per identified player. Returns the picks to save and the ones to delete. */
export function syncPicks(jobId: string, candidates: Map<string, Candidate[]>, existing: BgPick[]): { picks: BgPick[]; put: BgPick[]; remove: string[] } {
  const byPlayer = new Map(existing.map((p) => [p.playerId, p]));
  const put: BgPick[] = [], remove: string[] = [], picks: BgPick[] = [];
  for (const [playerId, pick] of byPlayer) if (!candidates.has(playerId)) remove.push(pick.id); // nobody accepted any more
  for (const [playerId, cands] of candidates) {
    const best = cands[0];
    const pick = byPlayer.get(playerId);
    if (!pick) {
      const blank: BgPick = { id: crypto.randomUUID(), jobId, playerId, detectionId: "", crop: best.frame.crop, autoCrop: best.frame.crop,
        cropEdited: false, chosen: false, included: true, flags: [], score: 0, outputBytes: null };
      const p = fromCandidate(blank, best);
      put.push(p);
      picks.push(p);
      continue;
    }
    const current = cands.find((c) => c.detection.id === pick.detectionId);
    let next = pick;
    if (!current) next = fromCandidate({ ...pick, chosen: false }, best); // rejected or reassigned in review
    else if (!pick.chosen && !pick.cropEdited && current !== best) next = fromCandidate(pick, best);
    else if (!pick.cropEdited && pick.score !== current.score) next = { ...pick, score: current.score, flags: [...current.frame.flags] };
    if (next !== pick) put.push(next);
    picks.push(next);
  }
  return { picks, put, remove };
}

function candidateOf(candidates: Map<string, Candidate[]>, pick: BgPick, detectionId: string): Candidate {
  const c = candidates.get(pick.playerId)?.find((x) => x.detection.id === detectionId);
  if (!c) throw new Error("That shot isn't an identified photo of this player any more");
  return c;
}

export const choose = (pick: BgPick, candidates: Map<string, Candidate[]>, detectionId: string): BgPick =>
  ({ ...fromCandidate(pick, candidateOf(candidates, pick, detectionId)), chosen: true });

export function setCrop(pick: BgPick, candidates: Map<string, Candidate[]>, view: JobView, x: number, y: number, w: number): BgPick {
  const c = candidateOf(candidates, pick, pick.detectionId);
  const crop = normalizeCrop(x, y, w, c.photo.width ?? 1, c.photo.height ?? 1, BANNER_ASPECT);
  const people = view.detections.filter((d) => d.photoId === c.photo.id);
  return { ...pick, crop, cropEdited: true, flags: frame(c.photo, people, c.detection, crop).flags, outputBytes: null };
}

export const resetCrop = (pick: BgPick, candidates: Map<string, Candidate[]>): BgPick =>
  fromCandidate(pick, candidateOf(candidates, pick, pick.detectionId));
