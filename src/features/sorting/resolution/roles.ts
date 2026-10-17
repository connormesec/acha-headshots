/** Goalie rules, applied around the IdentityResolver. Pure functions. Port of resolution/roles.py.
 *
 * A person who looks like a goalie is only matched against roster goalies, and a skater is never
 * given a goalie's name. The rules apply only when the roster marks its goalies (position "G");
 * otherwise identification works exactly as before. */

import { byId, goalies, isGoalie, knowsGoalies, restrictedTo, type Resolution, type Roster } from "../domain";
import type { Role } from "../types";

export function classifyRole(goalieProbability: number, goalieThreshold: number, skaterThreshold: number): Role {
  if (goalieProbability >= goalieThreshold) return "goalie";
  if (goalieProbability < skaterThreshold) return "skater";
  return "unsure";
}

/** The players this person may be. An unsure role keeps everyone (and is checked later). */
export function rosterForRole(roster: Roster, role: Role | null): Roster {
  if (role === null || role === "unsure" || !knowsGoalies(roster)) return roster;
  return restrictedTo(roster, role === "goalie");
}

function withNote(r: Resolution, note: string, changes: Partial<Resolution> = {}): Resolution {
  const reasoning = r.reasoning ? `${note}. ${r.reasoning}`.trim() : note;
  return { ...r, ...changes, reasoning };
}

/** Adjust a resolution made against `rosterForRole(roster, role)`. */
export function applyRole(r: Resolution, roster: Roster, role: Role | null, goalieProbability: number | null): Resolution {
  if (role === null || !knowsGoalies(roster)) return r;
  const p = goalieProbability ?? 0;
  if (role === "goalie") return goalie(r, roster, p);
  if (role === "skater") return withNote(r, `Not a goalie (${p.toFixed(2)}), so roster goalies were excluded`);
  // Unsure: never auto-accept a goalie's name for someone who may be a skater.
  const top = byId(roster, r.playerId);
  if (top && isGoalie(top) && r.status === "AUTO_ACCEPTED") {
    return withNote(r, `Matched goalie ${top.displayName}, but it's unclear whether this is a goalie (${p.toFixed(2)})`,
      { status: "NEEDS_REVIEW", flags: [...r.flags, "maybe_goalie"] });
  }
  return r;
}

/** A single digit read could be half of a two-digit number (1 -> 31). */
const partialOf = (n: number | null, other: number | null) =>
  n !== null && other !== null && n < 10 && other >= 10 && String(other).includes(String(n));

/** A goalie is one of our (few) goalies or an opponent's, so every roster goalie is offered to the
 * reviewer, and a weak or partial number read never decides it alone. */
function goalie(r: Resolution, roster: Roster, p: number): Resolution {
  let note = `Looks like a goalie (${p.toFixed(2)}), so only roster goalies were considered`;
  const flags = [...r.flags];
  let status = r.status;
  const present = new Set(r.candidates.map((c) => c.playerId));
  const candidates = [
    ...r.candidates,
    ...goalies(roster).filter((g) => !present.has(g.id)).map((g) => ({
      playerId: g.id, signals: { number: null, face: null, visual: null, vision: null }, finalScore: 0,
      reasoning: `${g.displayName} #${g.jerseyNumber ?? "–"}: roster goalie, number not read`,
    })),
  ];
  if (!r.candidates.length) {
    note += "; no goalie number read";
    flags.push("goalie_no_number");
  }
  const top = byId(roster, r.playerId);
  if (top && status === "AUTO_ACCEPTED") {
    const partner = goalies(roster).find((g) => g.id !== top.id && partialOf(top.jerseyNumber, g.jerseyNumber));
    if (partner) {
      status = "NEEDS_REVIEW";
      flags.push("partial_number");
      note += `; #${top.jerseyNumber} may be part of #${partner.jerseyNumber} (${partner.displayName})`;
    }
  }
  if (status === "UNKNOWN") status = "NEEDS_REVIEW"; // a goalie always gets a decision, with our goalies offered
  return withNote(r, note, { status, candidates, flags });
}
