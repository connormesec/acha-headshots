import { describe, expect, it } from "vitest";
import type { ImportedRoster } from "../shared/roster/imported";
import { exportTeams, importTeams } from "../src/features/rosters/lib/io";
import { applyImport, parseManual, suggestAbbreviation } from "../src/features/rosters/lib/sync";
import type { Team } from "../src/features/sorting/types";

const imported = (...players: [string, number | null, string][]): ImportedRoster => ({
  source: "acha", team_name: "T", season_id: null, season_name: null,
  players: players.map(([id, n, name]) => ({
    external_id: id, first_name: name.split(" ")[0], last_name: name.split(" ").pop()!, display_name: name,
    jersey_number: n, position: null, headshot_url: null,
  })),
});

describe("roster sync (port of test_sync_adds_updates_deactivates_and_reactivates)", () => {
  it("adds, updates, deactivates and reactivates by external id", () => {
    const r1 = applyImport("t", [], imported(["1", 7, "Al One"], ["2", 12, "Bo Two"]));
    expect(r1.result).toMatchObject({ added: 2, updated: 0, deactivated: 0 });
    const bo = r1.players.find((p) => p.externalId === "2")!;

    // Bo changes number, Al leaves, Cy joins
    const r2 = applyImport("t", r1.players, imported(["2", 13, "Bo Two"], ["3", 91, "Cy Three"]));
    expect(r2.result).toMatchObject({ added: 1, updated: 1, deactivated: 1 });
    expect(r2.players.find((p) => p.id === bo.id)!.jerseyNumber).toBe(13); // same player: existing tags stay valid
    expect(r2.players.find((p) => p.externalId === "1")!.active).toBe(false);

    const r3 = applyImport("t", r2.players, imported(["1", 7, "Al One"], ["2", 13, "Bo Two"], ["3", 91, "Cy Three"]));
    expect(r3.result).toMatchObject({ reactivated: 1, added: 0 });
  });

  it("suggests unique short names", () => {
    expect(suggestAbbreviation("Montana State University", ["MSU"])).toBe("MSU2");
    expect(suggestAbbreviation("Grizzlies", [])).toBe("GRIZ");
  });

  it("parses a typed roster", () => {
    expect(parseManual("27 Bob Johnson\n#12 Mike Jones\nTom Wilson, 91\n30 Sam Keeper G\nNo Number")).toEqual([
      { displayName: "Bob Johnson", jerseyNumber: 27, position: null },
      { displayName: "Mike Jones", jerseyNumber: 12, position: null },
      { displayName: "Tom Wilson", jerseyNumber: 91, position: null },
      { displayName: "Sam Keeper", jerseyNumber: 30, position: "G" },
      { displayName: "No Number", jerseyNumber: null, position: null },
    ]);
  });
});

describe("teams file", () => {
  it("round-trips, and drops anything unsafe", () => {
    const team: Team = { id: "x", name: "MSU", abbreviation: "MSU", source: "acha", sourceConfig: { type: "acha", team_id: "51", season_id: null }, lastSyncedAt: null, createdAt: "" };
    const { players } = applyImport("x", [], imported(["1", 7, "Al One"]));
    const file = exportTeams([team], new Map([["x", [{ ...players[0], headshotUrl: "javascript:alert(1)" }]]]));
    const [back] = importTeams(JSON.stringify(file));
    expect(back.team).toMatchObject({ name: "MSU", sourceConfig: { type: "acha", team_id: "51" } });
    expect(back.players[0]).toMatchObject({ displayName: "Al One", jerseyNumber: 7, headshotUrl: null, teamId: back.team.id });
    expect(() => importTeams("{}")).toThrow(/isn't a teams file/);
  });
});
