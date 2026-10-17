/** Rosters and evidence. Evidence (numbers read, vision answers) is kept apart from identity (a
 * roster player): only the IdentityResolver maps one onto the other. Port of schemas/domain.py. */

import type { ObservationSource, Player, ResolutionStatus, Signals } from "./types";

export const GOALIE = "G";
const GOALIE_WORDS = new Set(["g", "goalie", "goaltender", "goalkeeper", "gk", "gt"]);

/** Rosters spell positions many ways; goalies always become "G". */
export function normalizePosition(value: string | null | undefined): string | null {
  if (value == null || !value.trim()) return null;
  const v = value.trim();
  return GOALIE_WORDS.has(v.toLowerCase().replace(/\.+$/, "")) ? GOALIE : v.toUpperCase().slice(0, 10);
}

export interface Roster {
  team: { id: string; name: string; abbreviation: string };
  players: Player[];
}

export const isGoalie = (p: Player) => p.position === GOALIE;
export const byId = (r: Roster, id: string | null | undefined) => (id == null ? undefined : r.players.find((p) => p.id === id));
export const playersWithNumber = (r: Roster, n: number) => r.players.filter((p) => p.active && p.jerseyNumber === n);

export function duplicateNumbers(r: Roster): Set<number> {
  const counts = new Map<number, number>();
  for (const p of r.players) if (p.active && p.jerseyNumber !== null) counts.set(p.jerseyNumber, (counts.get(p.jerseyNumber) ?? 0) + 1);
  return new Set([...counts].filter(([, c]) => c > 1).map(([n]) => n));
}

export const rosterNumbers = (r: Roster) =>
  [...new Set(r.players.filter((p) => p.active && p.jerseyNumber !== null).map((p) => p.jerseyNumber!))].sort((a, b) => a - b);

export const goalies = (r: Roster) => r.players.filter((p) => p.active && isGoalie(p));
/** Role rules only apply when the roster says who the goalies are. */
export const knowsGoalies = (r: Roster) => goalies(r).length > 0;
/** The roster with only goalies (or only non-goalies) left. */
export const restrictedTo = (r: Roster, goaliesOnly: boolean): Roster =>
  ({ team: r.team, players: r.players.filter((p) => isGoalie(p) === goaliesOnly) });

export const uniquelyOnRoster = (r: Roster, n: number | null) => n !== null && playersWithNumber(r, n).length === 1;

// ------------------------------------------------------------------ evidence

/** A jersey number was observed (by OCR, the vision model, or a human). */
export interface NumberEvidence { number: number; confidence: number; source: ObservationSource; region?: string | null }
/** Face similarity against a roster player's reference photos (not used yet). */
export interface FaceEvidence { playerId: string; score: number }
/** Appearance similarity against a roster player (not used yet). */
export interface VisualEvidence { playerId: string; score: number }
/** The vision model believes this person wears a roster *number* (never a name). */
export interface VisionEvidence { number: number; confidence: number }

export type ResolutionOutcome = Extract<ResolutionStatus, "AUTO_ACCEPTED" | "NEEDS_REVIEW" | "UNKNOWN">;

export interface CandidateScore { playerId: string; signals: Signals; finalScore: number; reasoning: string }

export interface Resolution {
  status: ResolutionOutcome;
  playerId: string | null;
  finalScore: number;
  signals: Signals;
  candidates: CandidateScore[];
  reasoning: string;
  flags: string[];
}

export const NO_SIGNALS: Signals = { number: null, face: null, visual: null, vision: null };
