/** Rosters from a team website running the Puck Press WordPress plugin, using its public REST API:
 *
 *     GET {site}/wp-json/puck-press/v1/rosters/{roster_id}/players
 *     -> {"success": true, "data": [{"player_id", "number", "name", "pos", "headshot_link", "api_team_name", ...}]}
 *
 * The site's main roster is usually id 1. Port of providers/roster/puckpress.py. */

import { clean, isRecord, parseJerseyNumber, RosterSourceError, splitName, type ImportedPlayer, type ImportedRoster } from "./imported";

export const API_PREFIX = "/wp-json/puck-press/v1";
const NON_PLAYER_POSITIONS = new Set(["coach", "hc", "ac", "head coach", "assistant coach", "staff", "manager"]);

/** "msuhockey.com" -> "https://msuhockey.com". Only https: the server fetches it. */
export function normalizeSiteUrl(url: string): string {
  let raw = url.trim();
  if (!raw) throw new RosterSourceError("Enter the website address, e.g. https://msuhockey.com");
  if (!raw.includes("://")) raw = `https://${raw}`;
  let parts: URL;
  try {
    parts = new URL(raw);
  } catch {
    throw new RosterSourceError(`'${url}' isn't a valid website address`);
  }
  if (parts.protocol === "http:") parts.protocol = "https:";
  if (parts.protocol !== "https:" || !parts.hostname || parts.username || parts.password) {
    throw new RosterSourceError(`'${url}' isn't a valid website address`);
  }
  let path = parts.pathname.replace(/\/+$/, "");
  if (path.includes("/wp-json")) path = path.split("/wp-json")[0]; // tolerate a pasted API URL
  return `https://${parts.host}${path}`;
}

export function rosterUrl(siteUrl: string, rosterId: number): string {
  return `${normalizeSiteUrl(siteUrl)}${API_PREFIX}/rosters/${Math.trunc(rosterId)}/players`;
}

export function parseRoster(body: unknown, what: string, rosterId: number): ImportedRoster {
  if (!isRecord(body) || body.success !== true || !Array.isArray(body.data)) {
    const err = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : null;
    throw new RosterSourceError(err ?? `${what} didn't return a Puck Press roster`);
  }
  const players = new Map<string, ImportedPlayer>();
  const teamNames = new Map<string, number>();
  for (const row of body.data.filter(isRecord)) {
    const pid = clean(row.player_id);
    const name = clean(row.name);
    if (!pid || !name || NON_PLAYER_POSITIONS.has(clean(row.pos).toLowerCase())) continue;
    const team = clean(row.api_team_name);
    if (team) teamNames.set(team, (teamNames.get(team) ?? 0) + 1);
    if (players.has(pid)) continue; // a roster can combine several source teams
    const [first, last] = splitName(name);
    const headshot = clean(row.headshot_link);
    players.set(pid, {
      external_id: pid, first_name: first, last_name: last, display_name: name,
      jersey_number: parseJerseyNumber(row.number), position: clean(row.pos) || null,
      headshot_url: /^https?:\/\//i.test(headshot) ? headshot : null,
    });
  }
  if (!players.size) throw new RosterSourceError(`Roster ${rosterId} on ${what} has no players yet`);
  let teamName = what, best = 0;
  for (const [name, n] of teamNames) if (n > best) [teamName, best] = [name, n];
  return { source: "puckpress", team_name: teamName, season_id: null, season_name: null, players: [...players.values()] };
}
