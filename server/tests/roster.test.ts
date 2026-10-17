/** Roster import from team websites and ACHA, against a fake upstream (no live requests).
 * Port of tests/test_roster_import.py. */

import request from "supertest";
import { describe, expect, it } from "vitest";
import { splitDivision } from "../../shared/roster/acha";
import { RosterSourceError } from "../../shared/roster/imported";
import { normalizeSiteUrl } from "../../shared/roster/puckpress";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { isPublicAddress, type Fetcher } from "../src/roster/fetch";
import { AchaClient, fetchPuckPress } from "../src/roster/routes";

const BOOTSTRAP = {
  current_season_id: "73",
  regularSeasons: [
    { id: "73", name: "2026-2027 Men's Divisions" },
    { id: "74", name: "2026-27 Women's Divisions" },
    { id: "60", name: "2025-2026 Men's Divisions" },
  ],
};
const TEAMS: Record<string, object[]> = {
  "73": [{ id: -1, name: "All Teams" },
    { id: "51", name: "MD2 Montana State University", nickname: "Bobcats", logo: "l51.png" },
    { id: "508", name: "MD2 University of Montana", nickname: "Grizzlies" },
    { id: "900", name: "MD1 Arizona State University", nickname: "Sun Devils" }],
  "74": [{ id: "593", name: "WD1 Montana State University", nickname: "Bobcats" }],
};
const achaRoster = (players: [string, string, string][], teamName = "MD2 Montana State University") => ({
  teamName,
  roster: [{ sections: [
    { title: "Forwards", data: players.map(([pid, num, name]) => ({ row: { player_id: pid, tp_jersey_number: num, name, position: "F" } })) },
    { title: "Coaches", data: [{ row: { player_id: "c1", tp_jersey_number: "", name: "Coach Carter" } }] },
  ] }],
});
const ROSTERS: Record<string, object> = {
  "51:73": achaRoster([]), // new season, not published yet
  "51:60": achaRoster([["101", "27", "Bob Johnson"], ["102", "12", "Mike Jones"], ["103", "", "No Number"]]),
};
const PUCKPRESS_PLAYERS = [
  { player_id: "101", number: "27", name: "Bob Johnson", pos: "F", headshot_link: "https://x/101.jpg", api_team_name: "Montana State Bobcats" },
  { player_id: "101", number: "27", name: "Bob Johnson", pos: "F", api_team_name: "Montana State Bobcats" },
  { player_id: "104", number: "#9", name: "Ryan Miller", pos: "D", api_team_name: "Montana State Bobcats" },
  { player_id: "coach", number: "", name: "Head Coach", pos: "Coach" },
];

const fake: Fetcher & { urls: string[] } = {
  urls: [],
  async getText(raw: string, what: string) {
    this.urls.push(raw);
    const url = new URL(raw);
    const p = url.searchParams;
    if (url.host === "lscluster.hockeytech.com") {
      const view = p.get("view");
      const data = view === "bootstrap" ? BOOTSTRAP
        : view === "teamsForSeason" ? { teams: TEAMS[p.get("season")!] ?? [] }
        : view === "roster" ? ROSTERS[`${p.get("team_id")}:${p.get("season_id")}`] ?? achaRoster([])
        : null;
      if (!data) throw new RosterSourceError(`${what} returned HTTP 400`);
      return `(${JSON.stringify(data)})`; // JSONP-style wrapper
    }
    if (url.host === "msuhockey.test") {
      if (url.pathname === "/wp-json/puck-press/v1/rosters/1/players") return JSON.stringify({ success: true, data: PUCKPRESS_PLAYERS, meta: {} });
      throw new RosterSourceError(`${what} returned 404 (not found)`);
    }
    if (url.host === "notwordpress.test") return "<html>hello</html>";
    throw new RosterSourceError(`Couldn't reach ${what}. Check the address and that the site is online.`);
  },
};

describe("ACHA", () => {
  const acha = new AchaClient(fake, "key");

  it("splits the division prefix off", () => {
    expect(splitDivision("MD2 Montana State University")).toEqual(["Montana State University", "Men's D2"]);
    expect(splitDivision("AW Some Affiliate")).toEqual(["Some Affiliate", "Women's affiliate"]);
    expect(splitDivision("Plain Name")).toEqual(["Plain Name", null]);
  });

  it("searches the current men's and women's seasons", async () => {
    const teams = await acha.searchTeams("montana", null);
    expect(teams.map((t) => [t.id, t.division])).toEqual([["51", "Men's D2"], ["593", "Women's D1"], ["508", "Men's D2"]]);
    expect(teams[0]).toMatchObject({ name: "Montana State University", nickname: "Bobcats" });
    expect((await acha.searchTeams("sun devils", null))[0].id).toBe("900");
  });

  it("falls back to the latest published season", async () => {
    const roster = await acha.fetchRoster("51", null);
    expect(roster).toMatchObject({ season_id: "60", team_name: "Montana State University" });
    expect(roster.players.map((p) => [p.external_id, p.jersey_number, p.last_name])).toEqual([
      ["101", 27, "Johnson"], ["102", 12, "Jones"], ["103", null, "Number"]]); // coaches skipped
    expect(roster.players[0].headshot_url).toMatch(/\/101\.jpg$/);
  });

  it("errors on a pinned season with no roster", async () => {
    await expect(acha.fetchRoster("51", "73")).rejects.toThrow(/no published roster for season 73/);
  });
});

describe("team websites (Puck Press plugin)", () => {
  it("normalises the address, https only", () => {
    expect(normalizeSiteUrl("msuhockey.com")).toBe("https://msuhockey.com");
    expect(normalizeSiteUrl("https://msuhockey.com/")).toBe("https://msuhockey.com");
    expect(normalizeSiteUrl("https://x.com/wp-json/puck-press/v1/teams")).toBe("https://x.com");
    expect(normalizeSiteUrl("http://x.com/wordpress/")).toBe("https://x.com/wordpress");
    expect(() => normalizeSiteUrl("ftp://x.com")).toThrow(RosterSourceError);
    expect(() => normalizeSiteUrl("https://user:pw@x.com")).toThrow(RosterSourceError);
  });

  it("parses and de-duplicates the roster", async () => {
    const roster = await fetchPuckPress(fake, "msuhockey.test", 1);
    expect(roster.team_name).toBe("Montana State Bobcats");
    expect(roster.players.map((p) => [p.external_id, p.jersey_number])).toEqual([["101", 27], ["104", 9]]);
  });

  it("explains the roster id when it's missing", async () => {
    await expect(fetchPuckPress(fake, "msuhockey.test", 7)).rejects.toThrow(/main roster is usually 1/);
  });

  it("says a non-WordPress site isn't valid JSON", async () => {
    await expect(fetchPuckPress(fake, "notwordpress.test", 1)).rejects.toThrow(/valid JSON/);
  });

  it("says an unreachable site couldn't be reached", async () => {
    await expect(fetchPuckPress(fake, "nowhere.test", 1)).rejects.toThrow(/Couldn't reach/);
  });
});

describe("private addresses are never fetched", () => {
  it("knows which addresses are private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses localhost and private IPs through the real fetcher", async () => {
    const { httpsFetcher } = await import("../src/roster/fetch");
    const f = httpsFetcher({ timeoutMs: 3000 });
    await expect(f.getText("https://127.0.0.1/wp-json/x", "that site")).rejects.toThrow(/Couldn't reach/);
    await expect(f.getText("https://localhost/wp-json/x", "that site")).rejects.toThrow(/Couldn't reach/);
    await expect(f.getText("https://169.254.169.254/latest/meta-data", "that site")).rejects.toThrow(/Couldn't reach/);
    await expect(f.getText("http://example.com/", "that site")).rejects.toThrow(/only https/);
  });
});

describe("/api/roster", () => {
  it("validates parameters and returns user-facing errors", async () => {
    const { app } = await createApp(loadConfig({ STATIC_DIR: "x" }), { fetcher: fake });
    expect((await request(app).get("/api/roster/acha/roster?team=abc")).status).toBe(400);
    const ok = await request(app).get("/api/roster/acha/roster?team=51");
    expect(ok.status).toBe(200);
    expect(ok.body.players).toHaveLength(3);
    const missing = await request(app).get("/api/roster/puckpress?site=msuhockey.test&roster=7");
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/main roster is usually 1/);
  });
});
