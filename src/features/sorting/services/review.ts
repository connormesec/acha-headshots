/** Human review actions as pure functions: each takes the detection (or photo) and returns the
 * changed copy, which the caller saves. Port of services/review_service.py. Only CONFIRMED
 * matches are human decisions; AI predictions (AUTO_ACCEPTED) are never promoted automatically. */

import type { Detection, Match, MatchStatus, Photo, Player } from "../types";

const ACCEPTED: ReadonlySet<MatchStatus> = new Set(["AUTO_ACCEPTED", "CONFIRMED", "NEEDS_REVIEW"]);

export class ReviewError extends Error {} // shown to the user

const newId = () => crypto.randomUUID();

/** Every other candidate that was accepted or up for review is now rejected. */
const demoteOthers = (matches: Match[], keepId: string): Match[] =>
  matches.map((m) => (m.id !== keepId && ACCEPTED.has(m.status) ? { ...m, status: "REJECTED" } : m));

export function confirmMatch(d: Detection, matchId: string): Detection {
  if (!d.matches.some((m) => m.id === matchId)) throw new ReviewError("That candidate isn't on this person any more");
  const matches = demoteOthers(d.matches, matchId).map((m) => (m.id === matchId ? { ...m, status: "CONFIRMED" as const } : m));
  return { ...d, matches, status: "CONFIRMED" };
}

/** This candidate is wrong. The person stays in the review queue for another choice. */
export function rejectMatch(d: Detection, matchId: string): Detection {
  const matches = d.matches.map((m) => (m.id === matchId ? { ...m, status: "REJECTED" as const } : m));
  const stillTagged = matches.some((m) => m.status === "AUTO_ACCEPTED" || m.status === "CONFIRMED");
  return { ...d, matches, status: stillTagged ? d.status : "NEEDS_REVIEW" };
}

/** A reviewer picks a roster player (makes a match if there isn't one). */
export function assignPlayer(d: Detection, player: Player): Detection {
  let matches = d.matches;
  let match = matches.find((m) => m.playerId === player.id);
  if (!match) {
    match = {
      id: newId(), playerId: player.id, rank: matches.length, finalScore: 1,
      signals: { number: null, face: null, visual: null, vision: null },
      status: "CONFIRMED", reasoning: "Manually assigned by reviewer",
    };
    matches = [...matches, match];
  }
  const keep = match.id;
  matches = demoteOthers(matches, keep).map((m) => (m.id === keep ? { ...m, status: "CONFIRMED" as const } : m));
  const observations = player.jerseyNumber === null ? d.observations
    : [...d.observations, { number: player.jerseyNumber, confidence: 1, source: "MANUAL" as const, region: "review" }];
  return { ...d, matches, observations, status: "CONFIRMED" };
}

/** Not a roster player / can't tell. Takes it out of the review queue. */
export function markUnknown(d: Detection): Detection {
  return { ...d, matches: d.matches.map((m) => (m.status !== "PROPOSED" ? { ...m, status: "REJECTED" } : m)), status: "REJECTED" };
}

/** For a photo where detection found nobody: a whole-photo person, tagged by the reviewer. */
export function tagWholePhoto(photo: Photo, index: number, player: Player): { photo: Photo; detection: Detection } {
  if (photo.status === "FAILED") throw new ReviewError("You can't tag players in a photo that failed to process");
  const detection: Detection = {
    id: newId(), jobId: photo.jobId, photoId: photo.id, index,
    box: { x: 0, y: 0, width: photo.width ?? 0, height: photo.height ?? 0 }, confidence: 0,
    status: "NEEDS_REVIEW", reasoning: "Manual detection added by reviewer",
    goalieScore: null, role: null, sharpness: null, manual: true, observations: [], matches: [],
  };
  return { photo: { ...photo, status: "PROCESSED", reviewed: true }, detection: assignPlayer(detection, player) };
}

/** The reviewer looked at a no-players photo and found nobody to tag. */
export const markPhotoReviewed = (photo: Photo): Photo => ({ ...photo, reviewed: true });
