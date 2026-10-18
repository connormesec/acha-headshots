/** Team creation and roster sync, as pure functions. Port of services/roster_service.py.
 *
 * Players are matched on `externalId` (the ACHA / team-website player id), so a re-sync updates
 * numbers and names in place and existing photo tags keep pointing at the same player. Players who
 * leave the roster are deactivated, never deleted. */

import { splitName, type ImportedPlayer, type ImportedRoster } from "../../../../shared/roster/imported";
import { normalizePosition } from "../../sorting/domain";
import type { Player, Team } from "../../sorting/types";

export interface SyncResult { added: number; updated: number; deactivated: number; reactivated: number; seasonName: string | null }

const STOP_WORDS = new Set(["of", "the", "and", "at"]);

export function suggestAbbreviation(name: string, taken: string[]): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  const base = (words.length > 1 ? words.map((w) => w[0]).join("").toUpperCase() : words.length ? words[0].slice(0, 4).toUpperCase() : "TEAM").slice(0, 8);
  const used = new Set(taken.map((t) => t.toLowerCase()));
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base}${n}`;
  return candidate;
}

/** A user-facing message, or null if it's fine. */
export function checkAbbreviation(abbr: string, teams: Team[], excludeId?: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(abbr.trim())) return "Short name must be 1-20 letters, numbers, - or _";
  const clash = teams.find((t) => t.abbreviation.toLowerCase() === abbr.trim().toLowerCase() && t.id !== excludeId);
  return clash ? `Short name '${abbr.trim()}' is already used by ${clash.name}` : null;
}

function fromImported(teamId: string, ip: ImportedPlayer): Player {
  return {
    id: crypto.randomUUID(), teamId, externalId: ip.external_id, firstName: ip.first_name, lastName: ip.last_name,
    displayName: ip.display_name, jerseyNumber: ip.jersey_number, position: normalizePosition(ip.position),
    headshotUrl: ip.headshot_url, active: true,
  };
}

/** The players to save after importing `imported` into a team that has `existing`. */
export function applyImport(teamId: string, existing: Player[], imported: ImportedRoster): { players: Player[]; result: SyncResult } {
  const result: SyncResult = { added: 0, updated: 0, deactivated: 0, reactivated: 0, seasonName: imported.season_name };
  const byExternal = new Map(existing.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  const seen = new Set<string>();
  const out = new Map(existing.map((p) => [p.id, p]));
  for (const ip of imported.players) {
    seen.add(ip.external_id);
    const current = byExternal.get(ip.external_id);
    if (!current) {
      const p = fromImported(teamId, ip);
      out.set(p.id, p);
      result.added++;
      continue;
    }
    const next: Player = {
      ...current, firstName: ip.first_name, lastName: ip.last_name, displayName: ip.display_name,
      jerseyNumber: ip.jersey_number, headshotUrl: ip.headshot_url, position: normalizePosition(ip.position),
    };
    const changed = (["firstName", "lastName", "displayName", "jerseyNumber", "headshotUrl", "position"] as const).some((k) => current[k] !== next[k]);
    if (!current.active) {
      next.active = true;
      result.reactivated++;
    } else if (changed) result.updated++;
    out.set(next.id, next);
  }
  for (const [ext, p] of byExternal) {
    if (!seen.has(ext) && p.active) {
      out.set(p.id, { ...out.get(p.id)!, active: false });
      result.deactivated++;
    }
  }
  return { players: [...out.values()], result };
}

export interface ManualPlayer { displayName: string; jerseyNumber: number | null; position: string | null }

/** "27 Bob Johnson", "#27 Bob Johnson", "Bob Johnson, 27" or "Bob Johnson"; a trailing "G" marks a goalie. */
export function parseManual(text: string): ManualPlayer[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((raw) => {
    const goalie = /^(.+?)[\s,]+\(?(g|goalie|goaltender)\)?$/i.exec(raw);
    const line = goalie ? goalie[1].trim() : raw;
    const position = goalie ? "G" : null;
    const lead = /^#?(\d{1,2})[\s,.-]+(.+)$/.exec(line);
    if (lead) return { displayName: lead[2].trim().slice(0, 200), jerseyNumber: Number(lead[1]), position };
    const trail = /^(.+?)[\s,]+#?(\d{1,2})$/.exec(line);
    if (trail) return { displayName: trail[1].trim().slice(0, 200), jerseyNumber: Number(trail[2]), position };
    return { displayName: line.slice(0, 200), jerseyNumber: null, position };
  });
}

export function manualPlayers(teamId: string, list: ManualPlayer[]): Player[] {
  return list.map((m) => {
    const [first, last] = splitName(m.displayName);
    return {
      id: crypto.randomUUID(), teamId, externalId: null, firstName: first, lastName: last, displayName: m.displayName.trim(),
      jerseyNumber: m.jerseyNumber, position: normalizePosition(m.position), headshotUrl: null, active: true,
    };
  });
}

export function syncSummary(r: SyncResult): string {
  const parts = [
    r.added && `${r.added} added`, r.updated && `${r.updated} updated`,
    r.reactivated && `${r.reactivated} back on roster`, r.deactivated && `${r.deactivated} no longer listed`,
  ].filter(Boolean);
  return (parts.length ? parts.join(", ") : "No changes") + (r.seasonName ? ` · ${r.seasonName}` : "");
}
