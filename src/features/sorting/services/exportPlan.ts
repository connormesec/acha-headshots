/** Export: per-player folders of the original photos + manifest.csv. A photo with several
 * identified players goes in each player's folder. Port of services/export_service.py. */

import { acceptedMatch, UNRESOLVED, type Detection, type Photo, type Player } from "../types";
import { byPhoto } from "./stats";

export const NEEDS_REVIEW_DIR = "NEEDS REVIEW";
export const UNIDENTIFIED_DIR = "UNIDENTIFIED";
const MANIFEST_FIELDS = ["photo", "player_id", "player_name", "jersey_number", "confidence", "status"];

export interface ExportRow {
  photo: string;
  photoId: string;
  folder: string | null; // null: not in the ZIP (failed)
  playerId?: string;
  playerName?: string;
  jerseyNumber?: number | null;
  confidence?: number;
  status: string;
}

export function folderName(displayName: string, number: number | null): string {
  // eslint-disable-next-line no-control-regex
  const name = displayName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim() || "Unnamed";
  return number !== null ? `${name} - ${number}` : name;
}

export function planExport(photos: Photo[], detections: Detection[], players: Map<string, Player>): ExportRow[] {
  const people = byPhoto(detections);
  const rows: ExportRow[] = [];
  for (const photo of [...photos].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))) {
    if (photo.status === "FAILED") {
      rows.push({ photo: photo.filename, photoId: photo.id, folder: null, status: "FAILED" });
      continue;
    }
    const seen = new Set<string>();
    let unresolved = false;
    for (const d of people.get(photo.id) ?? []) {
      const m = acceptedMatch(d);
      const p = m && players.get(m.playerId);
      if (m && p && !seen.has(p.id)) {
        seen.add(p.id);
        rows.push({
          photo: photo.filename, photoId: photo.id, folder: folderName(p.displayName, p.jerseyNumber), playerId: p.id,
          playerName: p.displayName, jerseyNumber: p.jerseyNumber, confidence: Math.round(m.finalScore * 1e4) / 1e4, status: m.status,
        });
      } else if (!m && UNRESOLVED.has(d.status)) unresolved = true;
    }
    if (unresolved || (photo.status === "NO_PLAYERS" && !photo.reviewed)) {
      rows.push({ photo: photo.filename, photoId: photo.id, folder: NEEDS_REVIEW_DIR, status: "NEEDS_REVIEW" });
    } else if (!seen.size) {
      rows.push({ photo: photo.filename, photoId: photo.id, folder: UNIDENTIFIED_DIR, status: "UNIDENTIFIED" });
    }
  }
  return rows;
}

/** RFC 4180 quoting, like Python's csv module. */
export const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csvRow = (fields: string[]) => fields.map(csvField).join(",");

export function manifestCsv(rows: ExportRow[], playerKey: (r: ExportRow) => string = (r) => r.playerId ?? ""): string {
  const lines = [csvRow(MANIFEST_FIELDS)];
  for (const r of rows) {
    lines.push(csvRow([
      r.photo, playerKey(r), r.playerName ?? "", r.jerseyNumber == null ? "" : String(r.jerseyNumber),
      r.confidence === undefined ? "" : r.confidence.toFixed(2), r.status,
    ]));
  }
  return `${lines.join("\n")}\n`;
}
