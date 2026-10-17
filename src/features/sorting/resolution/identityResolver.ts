/** IdentityResolver: combines independent evidence into a roster identity. Pure logic, no I/O.
 * Providers produce *evidence*; this is the only place that decides *identity*.
 * Port of resolution/identity_resolver.py.
 *
 * Scoring: for every roster player referenced by any evidence, per-signal scores:
 *   number - best jersey-number confidence mapping to that player (small boost when independent
 *            sources such as OCR and the vision model agree)
 *   face   - best face-similarity score for that player
 *   visual - best appearance-similarity score for that player
 *   vision - best vision-model roster-number candidate mapping to that player
 *
 * `finalScore` is a weighted average over the signal types *present for this detection*. A
 * candidate that lacks a signal type the detection does have scores 0 for it, so disagreeing
 * evidence pulls the score down. Signal types with no evidence at all are left out rather than
 * counted as 0, so a strong jersey read isn't capped at 50% just because face recognition
 * isn't implemented.
 *
 * Guards that force review (never auto-accept):
 *   - two strong signals (>= strongSignalThreshold) point at different players
 *   - the top number maps to more than one roster player (duplicate jersey numbers)
 *   - the runner-up is within `ambiguityMargin` of the top candidate */

import { RESOLVER, type ResolverConfig } from "../config";
import {
  byId, duplicateNumbers, playersWithNumber,
  type CandidateScore, type FaceEvidence, type NumberEvidence, type Resolution, type ResolutionOutcome, type Roster,
  type VisionEvidence, type VisualEvidence,
} from "../domain";
import type { Signals } from "../types";

const SIGNALS = ["number", "face", "visual", "vision"] as const;
type Signal = (typeof SIGNALS)[number];

interface Accumulator { numberBySource: Map<string, number>; face: number; visual: number; vision: number }

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const f2 = (v: number) => v.toFixed(2);

export interface Evidence {
  numbers?: NumberEvidence[];
  faces?: FaceEvidence[];
  visuals?: VisualEvidence[];
  visions?: VisionEvidence[];
}

export function resolve(roster: Roster, ev: Evidence, config: ResolverConfig = RESOLVER): Resolution {
  const numbers = ev.numbers ?? [], faces = ev.faces ?? [], visuals = ev.visuals ?? [], visions = ev.visions ?? [];
  const present: Record<Signal, boolean> = { number: numbers.length > 0, face: faces.length > 0, visual: visuals.length > 0, vision: visions.length > 0 };
  const acc = new Map<string, Accumulator>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { numberBySource: new Map(), face: 0, visual: 0, vision: 0 }));
    return a;
  };
  const flags: string[] = [];
  const notes: string[] = [];
  const duplicates = duplicateNumbers(roster);
  // Every strong observation -> the set of players it points to. Used to detect conflicts.
  const strongVotes: Set<string>[] = [];
  const vote = (confidence: number, ids: string[]) => {
    if (confidence >= config.strongSignalThreshold) strongVotes.push(new Set(ids));
  };

  for (const obs of numbers) {
    const players = playersWithNumber(roster, obs.number);
    if (!players.length) {
      notes.push(`#${obs.number} (${obs.source} ${f2(obs.confidence)}) is not on the roster`);
      continue;
    }
    if (duplicates.has(obs.number) && !flags.includes("duplicate_number")) {
      flags.push("duplicate_number");
      notes.push(`#${obs.number} is shared by ${players.length} roster players`);
    }
    for (const p of players) {
      const a = get(p.id);
      a.numberBySource.set(obs.source, Math.max(a.numberBySource.get(obs.source) ?? 0, obs.confidence));
    }
    vote(obs.confidence, players.map((p) => p.id));
  }

  for (const obs of visions) {
    const players = playersWithNumber(roster, obs.number);
    if (!players.length) {
      notes.push(`vision candidate #${obs.number} is not on the roster`);
      continue;
    }
    if (duplicates.has(obs.number) && !flags.includes("duplicate_number")) flags.push("duplicate_number");
    for (const p of players) get(p.id).vision = Math.max(get(p.id).vision, obs.confidence);
    vote(obs.confidence, players.map((p) => p.id));
  }

  for (const f of faces) {
    if (!byId(roster, f.playerId)) continue;
    get(f.playerId).face = Math.max(get(f.playerId).face, f.score);
    vote(f.score, [f.playerId]);
  }

  for (const v of visuals) {
    if (!byId(roster, v.playerId)) continue;
    get(v.playerId).visual = Math.max(get(v.playerId).visual, v.score);
    vote(v.score, [v.playerId]);
  }

  if (!acc.size) {
    return {
      status: "UNKNOWN", playerId: null, finalScore: 0, signals: { number: null, face: null, visual: null, vision: null },
      candidates: [], flags,
      reasoning: notes.join("; ") || "No usable evidence (no jersey number, face, or vision result).",
    };
  }

  // Stable sort keeps first-seen order on ties, like Python's sorted().
  const candidates = [...acc].map(([id, a]) => score(id, a, present, roster, config)).sort((a, b) => b.finalScore - a.finalScore);
  const top = candidates[0];

  if (strongDisagreement(strongVotes)) {
    flags.push("signal_conflict");
    notes.push("strong signals disagree about who this is");
  }
  if (candidates.length > 1) {
    const runnerUp = candidates[1];
    if (runnerUp.finalScore >= config.reviewThreshold && top.finalScore - runnerUp.finalScore < config.ambiguityMargin) {
      flags.push("ambiguous");
      notes.push(`runner-up player ${byId(roster, runnerUp.playerId)?.displayName ?? runnerUp.playerId} scored ${f2(runnerUp.finalScore)} vs ${f2(top.finalScore)}`);
    }
  }

  return {
    status: status(top.finalScore, flags, config),
    playerId: top.playerId,
    finalScore: top.finalScore,
    signals: top.signals,
    candidates,
    reasoning: [top.reasoning, ...notes].join("; ").replace(/^[; ]+|[; ]+$/g, ""),
    flags,
  };
}

/** True if any two strong observations point at non-overlapping players. */
function strongDisagreement(votes: Set<string>[]): boolean {
  for (let i = 0; i < votes.length; i++) {
    for (let j = i + 1; j < votes.length; j++) {
      if (![...votes[i]].some((id) => votes[j].has(id))) return true;
    }
  }
  return false;
}

function score(playerId: string, a: Accumulator, present: Record<Signal, boolean>, roster: Roster, config: ResolverConfig): CandidateScore {
  let numberScore: number | null = null;
  if (a.numberBySource.size) {
    numberScore = Math.max(...a.numberBySource.values());
    if (a.numberBySource.size > 1) numberScore = Math.min(1, numberScore + config.agreementBoost);
  }
  const raw: Record<Signal, number | null> = { number: numberScore, face: a.face || null, visual: a.visual || null, vision: a.vision || null };
  const used = SIGNALS.filter((s) => present[s]);
  const total = used.reduce((t, s) => t + (config.weights[s] ?? 0), 0);
  const weighted = used.reduce((t, s) => t + (config.weights[s] ?? 0) * (raw[s] ?? 0), 0);
  const finalScore = total > 0 ? r4(weighted / total) : 0;

  const player = byId(roster, playerId);
  const label = player ? `${player.displayName} #${player.jerseyNumber ?? "–"}` : `player ${playerId}`;
  const parts = [...a.numberBySource].sort(([x], [y]) => (x < y ? -1 : 1)).map(([src, c]) => `number via ${src} ${f2(c)}`);
  for (const s of ["face", "visual", "vision"] as const) if (raw[s]) parts.push(`${s} ${f2(raw[s]!)}`);
  const signals = Object.fromEntries(SIGNALS.map((s) => [s, raw[s] === null ? null : r4(raw[s]!)])) as unknown as Signals;
  return { playerId, signals, finalScore, reasoning: `${label}: ${parts.join(", ")} (weights over ${used.join("/")})` };
}

function status(score: number, flags: string[], config: ResolverConfig): ResolutionOutcome {
  if (flags.length) return "NEEDS_REVIEW";
  if (score >= config.autoAcceptThreshold) return "AUTO_ACCEPTED";
  if (score >= config.reviewThreshold) return "NEEDS_REVIEW";
  return "UNKNOWN";
}
