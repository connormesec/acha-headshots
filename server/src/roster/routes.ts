/** /api/roster/*: fetches rosters for the browser. Public (it costs nothing), rate-limited, and only
 * ever to the ACHA stats feed or a team website's Puck Press API, at URLs the server builds. */

import { Router, type Response } from "express";
import {
  currentSeasons, feedUrl, parsePlayers, parseSeasons, parseTeams, rosterTeamName, searchTeams, SEASON_FALLBACKS,
} from "../../../shared/roster/acha";
import { decodeJson, isRecord, RosterSourceError, type AchaSeason, type AchaTeam, type ImportedRoster } from "../../../shared/roster/imported";
import { normalizeSiteUrl, parseRoster, rosterUrl } from "../../../shared/roster/puckpress";
import type { Fetcher } from "./fetch";

const ACHA = "The ACHA stats site";
const CACHE_TTL_MS = 6 * 3600_000;

export class AchaClient {
  private readonly cache = new Map<string, { at: number; data: unknown }>();

  constructor(private readonly fetcher: Fetcher, private readonly key: string, private readonly now: () => number = Date.now) {}

  private async get(cacheKey: string | null, params: Record<string, string>): Promise<Record<string, unknown>> {
    const hit = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.data as Record<string, unknown>;
    const data = decodeJson(await this.fetcher.getText(feedUrl(this.key, params), ACHA), ACHA);
    if (!isRecord(data)) throw new RosterSourceError(`${ACHA} returned an unexpected response`);
    if (cacheKey) {
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(cacheKey, { at: this.now(), data });
    }
    return data;
  }

  /** Regular seasons, newest first (men's and women's are separate seasons in ACHA). */
  async regularSeasons(): Promise<AchaSeason[]> {
    const seasons = parseSeasons(await this.get("bootstrap", { view: "bootstrap" }));
    if (!seasons.length) throw new RosterSourceError(`${ACHA} returned no seasons`);
    return seasons;
  }

  async teamsForSeason(season: AchaSeason): Promise<AchaTeam[]> {
    return parseTeams(await this.get(`teams:${season.id}`, { view: "teamsForSeason", season: season.id, division: "-1" }), season);
  }

  /** Search the current men's and women's seasons (or one given season) by name/nickname. */
  async searchTeams(query: string, seasonId: string | null): Promise<AchaTeam[]> {
    let seasons = await this.regularSeasons();
    if (seasonId) {
      const s = seasons.filter((x) => x.id === seasonId);
      seasons = s.length ? s : [{ id: seasonId, name: `Season ${seasonId}` }];
    } else seasons = currentSeasons(seasons);
    const all: AchaTeam[] = [];
    for (const season of seasons) all.push(...await this.teamsForSeason(season));
    return searchTeams(all, query);
  }

  /** With no season, the newest season whose roster has players (new seasons exist before teams
   * publish rosters). */
  async fetchRoster(teamId: string, seasonId: string | null): Promise<ImportedRoster> {
    const seasons = await this.regularSeasons();
    let candidates: AchaSeason[];
    if (seasonId) {
      const s = seasons.filter((x) => x.id === seasonId);
      candidates = s.length ? s : [{ id: seasonId, name: `Season ${seasonId}` }];
    } else candidates = seasons.slice(0, SEASON_FALLBACKS * 2); // men's and women's seasons interleave
    for (const season of candidates) {
      const data = await this.get(null, { view: "roster", team_id: teamId, season_id: season.id, league_id: "-1" });
      const players = parsePlayers(data);
      if (players.length) {
        return { source: "acha", team_name: rosterTeamName(data, teamId), season_id: season.id, season_name: season.name, players };
      }
    }
    throw new RosterSourceError(`ACHA team ${teamId} has no published roster for ${seasonId ? `season ${seasonId}` : "any recent season"}`);
  }
}

export async function fetchPuckPress(fetcher: Fetcher, site: string, rosterId: number): Promise<ImportedRoster> {
  const what = new URL(normalizeSiteUrl(site)).host;
  let text: string;
  try {
    text = await fetcher.getText(rosterUrl(site, rosterId), what);
  } catch (e) {
    if (e instanceof RosterSourceError && e.message.includes("404")) {
      throw new RosterSourceError(`${what} has no Puck Press roster ${rosterId}. Check the roster id (the main roster is usually 1) and that the Puck Press plugin is active.`);
    }
    throw e;
  }
  return parseRoster(decodeJson(text, what), what, rosterId);
}

const digits = (v: unknown, max = 12) => (typeof v === "string" && new RegExp(`^\\d{1,${max}}$`).test(v) ? v : null);

export function rosterRouter(fetcher: Fetcher, achaKey: string): Router {
  const r = Router();
  const acha = new AchaClient(fetcher, achaKey);
  const send = async (res: Response, work: () => Promise<unknown>) => {
    try {
      res.json(await work());
    } catch (e) {
      if (e instanceof RosterSourceError) res.status(400).json({ error: e.message });
      else {
        console.error("roster import failed:", e);
        res.status(502).json({ error: "Couldn't load that roster. Try again in a moment." });
      }
    }
  };

  r.get("/acha/seasons", (_req, res) => send(res, () => acha.regularSeasons()));

  r.get("/acha/teams", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const season = req.query.season === undefined || req.query.season === "" ? null : digits(req.query.season);
    if (season === null && req.query.season) return void res.status(400).json({ error: "Season must be a number" });
    return send(res, () => acha.searchTeams(q, season));
  });

  r.get("/acha/roster", (req, res) => {
    const team = digits(req.query.team);
    if (!team) return void res.status(400).json({ error: "ACHA team id must be a number" });
    const season = req.query.season ? digits(req.query.season) : null;
    if (req.query.season && !season) return void res.status(400).json({ error: "Season must be a number" });
    return send(res, () => acha.fetchRoster(team, season));
  });

  r.get("/puckpress", (req, res) => {
    const site = typeof req.query.site === "string" ? req.query.site.slice(0, 300) : "";
    const roster = Number(req.query.roster ?? 1);
    if (!Number.isInteger(roster) || roster < 1 || roster > 100_000) return void res.status(400).json({ error: "Roster id must be a whole number" });
    return send(res, () => fetchPuckPress(fetcher, site, roster));
  });

  return r;
}
