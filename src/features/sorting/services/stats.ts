/** Job counters and summaries, always recomputed from the photos and people so they can't drift.
 * Port of services/stats_service.py and the summary/review-queue routes in api/jobs.py. */

import { acceptedMatch, RESOLVED, UNRESOLVED, type Detection, type Job, type JobCounts, type Photo, type Player, type ResolutionStatus } from "../types";

export function photoNeedsReview(photo: Photo, statuses: ResolutionStatus[]): boolean {
  if (photo.status === "NO_PLAYERS") return !photo.reviewed;
  if (photo.status !== "PROCESSED") return false;
  return statuses.some((s) => UNRESOLVED.has(s));
}

export function photoIdentified(photo: Photo, statuses: ResolutionStatus[]): boolean {
  return photo.status === "PROCESSED" && statuses.some((s) => RESOLVED.has(s)) && !statuses.some((s) => UNRESOLVED.has(s));
}

export function byPhoto(detections: Detection[]): Map<string, Detection[]> {
  const out = new Map<string, Detection[]>();
  for (const d of detections) out.set(d.photoId, [...(out.get(d.photoId) ?? []), d]);
  for (const list of out.values()) list.sort((a, b) => a.index - b.index);
  return out;
}

export function computeCounts(photos: Photo[], detections: Detection[]): JobCounts {
  const people = byPhoto(detections);
  const statuses = (p: Photo) => (people.get(p.id) ?? []).map((d) => d.status);
  return {
    total: photos.length,
    processed: photos.filter((p) => p.status !== "PENDING").length,
    failed: photos.filter((p) => p.status === "FAILED").length,
    noPlayers: photos.filter((p) => p.status === "NO_PLAYERS").length,
    identified: photos.filter((p) => photoIdentified(p, statuses(p))).length,
    review: photos.filter((p) => photoNeedsReview(p, statuses(p))).length,
  };
}

/** After processing or a review action: REVIEW while anything is unresolved, else COMPLETED. */
export function settle(job: Job, counts: JobCounts, now = new Date().toISOString()): Job {
  if (!["PROCESSING", "REVIEW", "COMPLETED"].includes(job.status)) return { ...job, counts };
  return { ...job, counts, status: counts.review > 0 ? "REVIEW" : "COMPLETED", completedAt: job.completedAt ?? now };
}

// ------------------------------------------------------------------ results page

export interface PlayerTag { playerId: string; displayName: string; jerseyNumber: number | null; status: string }

export function photoTags(people: Detection[], players: Map<string, Player>): PlayerTag[] {
  const tags: PlayerTag[] = [];
  for (const d of people) {
    const m = acceptedMatch(d);
    const p = m && players.get(m.playerId);
    if (m && p && RESOLVED.has(d.status)) tags.push({ playerId: p.id, displayName: p.displayName, jerseyNumber: p.jerseyNumber, status: m.status });
  }
  return tags;
}

export interface PlayerBreakdown { player: Player; photos: Photo[]; automatic: number; confirmed: number }

/** Who was found, with their photos, by jersey number. */
export function summary(photos: Photo[], detections: Detection[], players: Map<string, Player>) {
  const people = byPhoto(detections);
  const by = new Map<string, { player: Player; photos: Map<string, Photo>; automatic: number; confirmed: number }>();
  let automatic = 0, confirmed = 0;
  for (const photo of photos) {
    for (const d of people.get(photo.id) ?? []) {
      const m = acceptedMatch(d);
      const player = m && players.get(m.playerId);
      if (!m || !player || !RESOLVED.has(d.status)) continue;
      const e = by.get(player.id) ?? { player, photos: new Map(), automatic: 0, confirmed: 0 };
      e.photos.set(photo.id, photo);
      if (m.status === "CONFIRMED") { e.confirmed++; confirmed++; } else { e.automatic++; automatic++; }
      by.set(player.id, e);
    }
  }
  const breakdown: PlayerBreakdown[] = [...by.values()]
    .map((e) => ({ player: e.player, photos: [...e.photos.values()], automatic: e.automatic, confirmed: e.confirmed }))
    .sort((a, b) => (a.player.jerseyNumber ?? 1000) - (b.player.jerseyNumber ?? 1000));
  return { automatic, confirmed, players: breakdown };
}

// ------------------------------------------------------------------ review queue

export type ReviewItem =
  | { kind: "detection"; photo: Photo; detectionId: string }
  | { kind: "photo"; photo: Photo };

/** Every person needing a decision, one item per person (a photo with three players is three
 * items). Photos with nobody detected are `kind: "photo"`. `includeResolved` also returns
 * identified, rejected and hidden people (for re-reviewing one photo). */
export function reviewQueue(photos: Photo[], detections: Detection[], opts: { includeResolved?: boolean; photoId?: string } = {}): ReviewItem[] {
  const people = byPhoto(detections);
  const items: ReviewItem[] = [];
  for (const photo of opts.photoId ? photos.filter((p) => p.id === opts.photoId) : photos) {
    if (photo.status === "NO_PLAYERS" && (opts.includeResolved || !photo.reviewed)) {
      items.push({ kind: "photo", photo });
      continue;
    }
    for (const d of people.get(photo.id) ?? []) {
      if (opts.includeResolved || UNRESOLVED.has(d.status)) items.push({ kind: "detection", photo, detectionId: d.id });
    }
  }
  return items;
}
