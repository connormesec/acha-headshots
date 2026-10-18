/** Roster import goes through this site's server (the ACHA feed refuses browsers, and team
 * websites shouldn't see who's visiting). Free and open to everyone. */

import type { AchaSeason, AchaTeam, ImportedRoster, SourceConfig } from "../../../shared/roster/imported";
import { api } from "../../app/api";

const q = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export const rosterApi = {
  achaSeasons: () => api<AchaSeason[]>("roster/acha/seasons"),
  searchAcha: (query: string, season?: string | null) => api<AchaTeam[]>(`roster/acha/teams?${q({ q: query, season })}`),
  fetch: (c: SourceConfig) => c.type === "acha"
    ? api<ImportedRoster>(`roster/acha/roster?${q({ team: c.team_id, season: c.season_id })}`)
    : api<ImportedRoster>(`roster/puckpress?${q({ site: c.site_url, roster: c.roster_id })}`),
};
