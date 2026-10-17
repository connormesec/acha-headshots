/** Port of tests/test_identity_resolver.py and the pure part of tests/test_goalies.py. */

import { describe, expect, it } from "vitest";
import { RESOLVER } from "../src/features/sorting/config";
import { normalizePosition, type CandidateScore, type NumberEvidence, type Resolution, type Roster } from "../src/features/sorting/domain";
import { resolve } from "../src/features/sorting/resolution/identityResolver";
import { applyRole, classifyRole, rosterForRole } from "../src/features/sorting/resolution/roles";
import type { Player } from "../src/features/sorting/types";

export function player(id: string, number: number | null, position: string | null = null, name = `Player ${id}`): Player {
  const [first, ...rest] = name.split(" ");
  return { id, teamId: "t", externalId: null, firstName: first, lastName: rest.join(" "), displayName: name, jerseyNumber: number, position, headshotUrl: null, active: true };
}
export const makeRoster = (numbers: Record<string, number>): Roster =>
  ({ team: { id: "t", name: "T", abbreviation: "T" }, players: Object.entries(numbers).map(([id, n]) => player(id, n)) });

// player id -> jersey number (John #27 = 1, Mike #12 = 2, Bob #91 = 3)
const ROSTER = makeRoster({ 1: 27, 2: 12, 3: 91 });
const num = (n: number, c: number, source: NumberEvidence["source"] = "OCR"): NumberEvidence => ({ number: n, confidence: c, source });

describe("IdentityResolver", () => {
  it("auto-accepts a strong number, leaving missing signal types out", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.96)] });
    expect(r).toMatchObject({ status: "AUTO_ACCEPTED", playerId: "1", finalScore: 0.96 });
    expect(r.signals.number).toBe(0.96);
  });

  it("auto-accepts a strong face alone", () => {
    const r = resolve(ROSTER, { faces: [{ playerId: "2", score: 0.95 }] });
    expect(r).toMatchObject({ status: "AUTO_ACCEPTED", playerId: "2" });
    expect(r.signals.face).toBe(0.95);
  });

  it("accepts number and face that agree", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.94)], faces: [{ playerId: "1", score: 0.91 }] });
    expect(r).toMatchObject({ status: "AUTO_ACCEPTED", playerId: "1", flags: [] });
    expect(r.signals).toMatchObject({ number: 0.94, face: 0.91 });
  });

  it("sends number and face that disagree to review", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.97)], faces: [{ playerId: "2", score: 0.95 }] });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("signal_conflict");
    expect(new Set(r.candidates.map((c) => c.playerId))).toEqual(new Set(["1", "2"]));
  });

  it("is UNKNOWN with no evidence", () => {
    const r = resolve(ROSTER, {});
    expect(r).toMatchObject({ status: "UNKNOWN", playerId: null, candidates: [] });
  });

  it("ranks several vision candidates and sends them to review", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.7)], visions: [{ number: 27, confidence: 0.61 }, { number: 12, confidence: 0.27 }] });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.candidates.map((c) => c.playerId)).toEqual(["1", "2"]);
    expect(r.candidates[0].finalScore).toBeGreaterThan(r.candidates[1].finalScore);
  });

  it("flags close candidates as ambiguous", () => {
    const r = resolve(ROSTER, { visions: [{ number: 27, confidence: 0.72 }, { number: 12, confidence: 0.68 }] });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("ambiguous");
  });

  it("is UNKNOWN for a number that isn't on the roster", () => {
    const r = resolve(ROSTER, { numbers: [num(55, 0.98)] });
    expect(r.status).toBe("UNKNOWN");
    expect(r.reasoning).toContain("not on the roster");
  });

  it("sends a shared jersey number to review", () => {
    const r = resolve(makeRoster({ 1: 27, 2: 27, 3: 12 }), { numbers: [num(27, 0.98)] });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("duplicate_number");
    expect(new Set(r.candidates.map((c) => c.playerId))).toEqual(new Set(["1", "2"]));
  });

  it("boosts the number score when OCR and the vision model agree", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.86), num(27, 0.88, "VISION_MODEL")] });
    expect(r.signals.number).toBe(0.93); // 0.88 + 0.05 agreement boost
    expect(r.status).toBe("AUTO_ACCEPTED");
  });

  it("sends strong OCR/vision disagreement to review", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.92), num(12, 0.91, "VISION_MODEL")] });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("signal_conflict");
  });

  it("has configurable weights", () => {
    const r = resolve(ROSTER, { numbers: [num(27, 0.95)], faces: [{ playerId: "1", score: 0.5 }] },
      { ...RESOLVER, weights: { number: 0.9, face: 0.1, visual: 0, vision: 0 } });
    expect(r.finalScore).toBe(Math.round((0.9 * 0.95 + 0.1 * 0.5) * 1e4) / 1e4);
  });

  it("has configurable thresholds", () => {
    expect(resolve(ROSTER, { numbers: [num(27, 0.96)] }, { ...RESOLVER, autoAcceptThreshold: 0.99 }).status).toBe("NEEDS_REVIEW");
    expect(resolve(ROSTER, { numbers: [num(27, 0.3)] }, { ...RESOLVER, reviewThreshold: 0.2 }).status).toBe("NEEDS_REVIEW");
    expect(resolve(ROSTER, { numbers: [num(27, 0.3)] }).status).toBe("UNKNOWN");
  });
});

// ------------------------------------------------------------------ goalie rules

const goalieRoster = (goalie = true): Roster => ({
  team: { id: "t", name: "T", abbreviation: "T" },
  players: [player("1", 31, goalie ? "G" : "F", "Goalie One"), player("2", 17, "F", "Skater Two")],
});
const twoGoalies = (): Roster => {
  const r = goalieRoster();
  r.players.push(player("3", 1, "G", "Goalie Three"));
  return r;
};
const cand = (playerId: string, score: number): CandidateScore =>
  ({ playerId, signals: { number: score, face: null, visual: null, vision: null }, finalScore: score, reasoning: "" });
const resolution = (status: Resolution["status"] = "AUTO_ACCEPTED", playerId = "1"): Resolution =>
  ({ status, playerId, finalScore: 0.95, signals: { number: 0.95, face: null, visual: null, vision: null }, candidates: [cand(playerId, 0.95)], reasoning: "", flags: [] });
const empty = (reasoning = ""): Resolution =>
  ({ status: "UNKNOWN", playerId: null, finalScore: 0, signals: { number: null, face: null, visual: null, vision: null }, candidates: [], reasoning, flags: [] });

describe("goalie rules", () => {
  it("normalises positions", () => {
    expect(["G", "goalie", "Goaltender", " g. ", "D", "lw", "", null].map(normalizePosition)).toEqual(["G", "G", "G", "G", "D", "LW", null, null]);
  });

  it("classifies by bands", () => {
    expect(classifyRole(0.9, 0.75, 0.35)).toBe("goalie");
    expect(classifyRole(0.5, 0.75, 0.35)).toBe("unsure");
    expect(classifyRole(0.1, 0.75, 0.35)).toBe("skater");
  });

  it("splits the roster by role only when goalies are known", () => {
    const ids = (r: Roster) => r.players.map((p) => p.id);
    expect(ids(rosterForRole(goalieRoster(), "goalie"))).toEqual(["1"]);
    expect(ids(rosterForRole(goalieRoster(), "skater"))).toEqual(["2"]);
    expect(ids(rosterForRole(goalieRoster(), "unsure"))).toEqual(["1", "2"]);
    expect(ids(rosterForRole(goalieRoster(false), "goalie"))).toEqual(["1", "2"]);
  });

  it("offers a goalie with no number every roster goalie", () => {
    const r = applyRole(empty("no evidence"), goalieRoster(), "goalie", 0.93);
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.candidates.map((c) => c.playerId)).toEqual(["1"]);
    expect(r.flags).toContain("goalie_no_number");
    expect(r.reasoning).toContain("Looks like a goalie (0.93)");
  });

  it("reviews a single digit that could be half of another goalie's number", () => {
    const r = applyRole(resolution("AUTO_ACCEPTED", "3"), twoGoalies(), "goalie", 0.98);
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("partial_number");
    expect(r.reasoning).toContain("#1 may be part of #31");
    expect(new Set(r.candidates.map((c) => c.playerId))).toEqual(new Set(["1", "3"]));
    expect(applyRole(resolution("AUTO_ACCEPTED", "1"), twoGoalies(), "goalie", 0.98).status).toBe("AUTO_ACCEPTED");
  });

  it("still gets a weak goalie read a decision, with all goalies", () => {
    const weak: Resolution = { ...empty(), playerId: "3", finalScore: 0.2, candidates: [cand("3", 0.2)] };
    const r = applyRole(weak, twoGoalies(), "goalie", 0.99);
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.candidates.map((c) => c.playerId)).toEqual(["3", "1"]);
  });

  it("never auto-accepts a goalie when unsure", () => {
    const r = applyRole(resolution(), goalieRoster(), "unsure", 0.5);
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("maybe_goalie");
    expect(applyRole(resolution("AUTO_ACCEPTED", "2"), goalieRoster(), "unsure", 0.5).status).toBe("AUTO_ACCEPTED");
  });

  it("changes nothing when the roster has no goalies", () => {
    const original = empty();
    expect(applyRole(original, goalieRoster(false), "goalie", 0.99)).toBe(original);
  });
});
