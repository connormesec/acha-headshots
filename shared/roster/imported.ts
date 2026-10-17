/** Types and helpers shared by external roster sources (team websites, ACHA).
 * Port of providers/roster/imported.py. */

export class RosterSourceError extends Error {} // the message is shown to the user

export interface ImportedPlayer {
  external_id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  jersey_number: number | null;
  position: string | null;
  headshot_url: string | null;
}

export interface ImportedRoster {
  source: "puckpress" | "acha";
  team_name: string;
  season_id: string | null;
  season_name: string | null;
  players: ImportedPlayer[];
}

export interface AchaSeason { id: string; name: string }

export interface AchaTeam {
  id: string;
  name: string; // without the division prefix
  division: string | null; // e.g. "Men's D2"
  nickname: string | null;
  logo: string | null;
  season_id: string;
  season_name: string;
}

export type SourceConfig =
  | { type: "puckpress"; site_url: string; roster_id: number }
  // season_id null = always the newest season with a published roster (follows season rollover)
  | { type: "acha"; team_id: string; season_id: string | null };

export function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ["", ""];
  if (parts.length === 1) return [parts[0], ""];
  return [parts[0], parts.slice(1).join(" ")];
}

export function parseJerseyNumber(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(/^#+/, "");
  return /^\d+$/.test(text) && Number(text) <= 99 ? Number(text) : null;
}

/** Parse JSON, tolerating the `( ... )` JSONP wrapper HockeyTech uses. */
export function decodeJson(text: string, what: string): unknown {
  let body = text.trim();
  if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1);
  try {
    return JSON.parse(body);
  } catch {
    throw new RosterSourceError(`${what} did not return valid JSON`);
  }
}

export const clean = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
