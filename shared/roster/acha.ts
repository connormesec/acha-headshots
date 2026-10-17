/** ACHA rosters from the public HockeyTech stat feed: URL building and response parsing.
 * Port of providers/roster/acha.py (the fetching lives in server/src/roster). */

import { clean, isRecord, parseJerseyNumber, splitName, type AchaSeason, type AchaTeam, type ImportedPlayer } from "./imported";

export const FEED = "https://lscluster.hockeytech.com/feed/index.php";
const DIVISION_PREFIX = /^(MD[1-3]|WD[1-3]|M[1-3]|W[1-3]|AM|AW)\s+/;
const DIVISION_LABEL: Record<string, string> = {
  MD1: "Men's D1", MD2: "Men's D2", MD3: "Men's D3", WD1: "Women's D1",
  WD2: "Women's D2", AM: "Men's affiliate", AW: "Women's affiliate",
};
export const SEASON_FALLBACKS = 4; // recent seasons to try when the newest roster is still empty

export function splitDivision(rawName: string): [string, string | null] {
  const m = DIVISION_PREFIX.exec(rawName);
  if (!m) return [rawName, null];
  return [rawName.slice(m[0].length), DIVISION_LABEL[m[1]] ?? m[1]];
}

export function feedUrl(key: string, params: Record<string, string>): string {
  const url = new URL(FEED);
  const all = { feed: "statviewfeed", key, client_code: "acha", site_id: "2", lang: "en", ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  return url.toString();
}

export function parseSeasons(data: unknown): AchaSeason[] {
  const list = isRecord(data) && Array.isArray(data.regularSeasons) ? data.regularSeasons : [];
  return list.filter(isRecord).map((s) => ({ id: String(s.id), name: clean(s.name) }));
}

export function parseTeams(data: unknown, season: AchaSeason): AchaTeam[] {
  const list = isRecord(data) && Array.isArray(data.teams) ? data.teams : [];
  const out: AchaTeam[] = [];
  for (const t of list.filter(isRecord)) {
    if (String(t.id) === "-1") continue;
    const [name, division] = splitDivision(clean(t.name));
    out.push({
      id: String(t.id), name, division, nickname: clean(t.nickname) || null,
      logo: typeof t.logo === "string" && t.logo ? t.logo : null, season_id: season.id, season_name: season.name,
    });
  }
  return out;
}

/** Newest men's and newest women's regular season. */
export function currentSeasons(seasons: AchaSeason[]): AchaSeason[] {
  const picked: AchaSeason[] = [];
  for (const women of [true, false]) {
    const match = seasons.find((s) => s.name.toLowerCase().includes("women") === women);
    if (match) picked.push(match);
  }
  return picked.length ? picked : seasons.slice(0, 1);
}

export function searchTeams(teams: AchaTeam[], query: string, limit = 25): AchaTeam[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const results = teams.filter((t) => {
    const hay = `${t.name} ${t.nickname ?? ""}`.toLowerCase();
    if (seen.has(t.id) || (q && !hay.includes(q))) return false;
    seen.add(t.id);
    return true;
  });
  const key = (t: AchaTeam) => [t.name.toLowerCase().startsWith(q) ? 0 : 1, t.name, t.division ?? ""] as const;
  results.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
  });
  return results.slice(0, limit);
}

export function parsePlayers(data: unknown): ImportedPlayer[] {
  let sections: unknown[];
  try {
    sections = ((data as { roster: { sections: unknown[] }[] }).roster[0].sections) ?? [];
    if (!Array.isArray(sections)) return [];
  } catch {
    return [];
  }
  const players = new Map<string, ImportedPlayer>();
  for (const section of sections.filter(isRecord)) {
    if (clean(section.title).toLowerCase() === "coaches") continue;
    for (const item of (Array.isArray(section.data) ? section.data : []).filter(isRecord)) {
      const row = isRecord(item.row) ? item.row : {};
      const pid = clean(row.player_id);
      const name = clean(row.name);
      if (!pid || !name) continue;
      const [first, last] = splitName(name);
      players.set(pid, {
        external_id: pid, first_name: first, last_name: last, display_name: name,
        jersey_number: parseJerseyNumber(row.tp_jersey_number),
        position: clean(row.position) || null,
        // Only digits reach the URL: player ids come from the feed.
        headshot_url: /^\d+$/.test(pid) ? `https://assets.leaguestat.com/acha/240x240/${pid}.jpg` : null,
      });
    }
  }
  return [...players.values()];
}

export function rosterTeamName(data: unknown, teamId: string): string {
  const [name] = splitDivision(clean(isRecord(data) ? data.teamName : ""));
  return name || `ACHA team ${teamId}`;
}
