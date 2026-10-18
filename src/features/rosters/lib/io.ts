/** Teams live only in this browser. This moves them to another browser or computer as a JSON file. */

import type { SourceConfig } from "../../../../shared/roster/imported";
import { normalizePosition } from "../../sorting/domain";
import type { Player, Team } from "../../sorting/types";

export const FORMAT = "acha-photo-tools/teams";
export interface TeamsFile { format: typeof FORMAT; version: 1; teams: (Omit<Team, "id"> & { players: Omit<Player, "id" | "teamId">[] })[] }

export function exportTeams(teams: Team[], players: Map<string, Player[]>): TeamsFile {
  return {
    format: FORMAT, version: 1,
    teams: teams.map(({ id, ...t }) => ({ ...t, players: (players.get(id) ?? []).map(({ id: _i, teamId: _t, ...p }) => p) })),
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 99 ? (v as number) : null);

function source(v: unknown): SourceConfig | null {
  const c = v as Record<string, unknown> | null;
  if (c?.type === "acha" && typeof c.team_id === "string" && /^\d{1,12}$/.test(c.team_id)) {
    return { type: "acha", team_id: c.team_id, season_id: typeof c.season_id === "string" && /^\d{1,12}$/.test(c.season_id) ? c.season_id : null };
  }
  if (c?.type === "puckpress" && typeof c.site_url === "string") {
    return { type: "puckpress", site_url: c.site_url.slice(0, 300), roster_id: Number.isInteger(c.roster_id) ? (c.roster_id as number) : 1 };
  }
  return null;
}

/** Validated teams from a file (anything unexpected is dropped). Throws a user-facing Error. */
export function importTeams(text: string): { team: Team; players: Player[] }[] {
  let data: TeamsFile;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a teams file (it isn't JSON).");
  }
  if (data?.format !== FORMAT || !Array.isArray(data.teams)) throw new Error("That file isn't a teams file from ACHA Photo Tools.");
  return data.teams.slice(0, 200).map((t) => {
    const id = crypto.randomUUID();
    const src = source(t.sourceConfig);
    const team: Team = {
      id, name: str(t.name, 200) || "Team", abbreviation: str(t.abbreviation, 20).replace(/[^A-Za-z0-9_-]/g, "") || "TEAM",
      source: src?.type ?? "manual", sourceConfig: src, lastSyncedAt: str(t.lastSyncedAt, 40) || null, createdAt: new Date().toISOString(),
    };
    const players: Player[] = (Array.isArray(t.players) ? t.players : []).slice(0, 300).map((p) => ({
      id: crypto.randomUUID(), teamId: id, externalId: str(p.externalId, 64) || null,
      firstName: str(p.firstName, 100), lastName: str(p.lastName, 100), displayName: str(p.displayName, 200) || "Player",
      jerseyNumber: num(p.jerseyNumber), position: normalizePosition(str(p.position, 20) || null),
      headshotUrl: /^https:\/\//.test(str(p.headshotUrl, 500)) ? str(p.headshotUrl, 500) : null, active: p.active !== false,
    }));
    return { team, players };
  });
}
