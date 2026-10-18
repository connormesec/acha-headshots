/** One 1080×440 JPEG (under 250 KB) per included player, named after them, plus manifest.csv. */

import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { getBlob, putBlob, savePicks } from "../../../db/repo";
import { uniqueOutputName } from "../../../lib/names";
import { renderCrop } from "../../../lib/render";
import { downloadBlob } from "../../../lib/zipio";
import { SourceReader } from "../../sorting/pipeline/sources";
import { csvRow } from "../../sorting/services/exportPlan";
import type { BgPick, Player } from "../../sorting/types";
import type { JobView } from "../../sorting/view";
import { BG_HEIGHT, BG_MAX_BYTES, BG_WIDTH, slug } from "./bannerCrop";

const MANIFEST = ["file", "player_id", "player_name", "jersey_number", "source_photo", "flags"];

/** Output names for the included picks, in jersey-number order (stable for the cards). */
export function outputNames(picks: BgPick[], players: Map<string, Player>): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const pick of orderPicks(picks, players).filter((p) => p.included)) {
    const p = players.get(pick.playerId)!;
    names.set(pick.id, uniqueOutputName(slug(p.firstName, p.lastName, p.displayName), taken));
  }
  return names;
}

export const orderPicks = (picks: BgPick[], players: Map<string, Player>) => [...picks].sort((a, b) => {
  const pa = players.get(a.playerId), pb = players.get(b.playerId);
  return (pa?.jerseyNumber ?? 1000) - (pb?.jerseyNumber ?? 1000) || (pa?.lastName ?? "").localeCompare(pb?.lastName ?? "");
});

export async function exportBackgrounds(view: JobView, picks: BgPick[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const included = orderPicks(picks, view.players).filter((p) => p.included);
  if (!included.length) throw new Error("No players to export. Identify some players first.");
  const names = outputNames(picks, view.players);
  const photos = new Map(view.photos.map((p) => [p.id, p]));
  const dets = new Map(view.detections.map((d) => [d.id, d]));
  const sources = new SourceReader();
  const zip = new ZipWriter(new BlobWriter("application/zip"), { level: 0, useWebWorkers: false });
  const rows: string[] = [csvRow(MANIFEST)];
  let done = 0;
  for (const pick of included) {
    const photo = photos.get(dets.get(pick.detectionId)!.photoId)!;
    let jpeg = pick.outputBytes !== null ? await getBlob(`bg:${pick.id}`) : undefined;
    if (!jpeg) {
      try {
        jpeg = await renderCrop(await sources.original(photo), pick.crop, { width: BG_WIDTH, height: BG_HEIGHT, maxBytes: BG_MAX_BYTES });
      } catch (e) {
        throw new Error(`${view.players.get(pick.playerId)?.displayName}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await putBlob(`bg:${pick.id}`, jpeg);
      await savePicks([{ ...pick, outputBytes: jpeg.size }]);
    }
    const name = names.get(pick.id)!;
    await zip.add(name, new BlobReader(jpeg));
    const p = view.players.get(pick.playerId)!;
    rows.push(csvRow([name, p.externalId ?? p.id, p.displayName, p.jerseyNumber === null ? "" : String(p.jerseyNumber), photo.filename, pick.flags.join(" ")]));
    onProgress?.(++done, included.length);
  }
  await zip.add("manifest.csv", new TextReader(`${rows.join("\n")}\n`), { level: 6 });
  const safe = view.job.name.replace(/[^A-Za-z0-9 _-]/g, "_").trim() || "players";
  downloadBlob(await zip.close(), `${safe} - player backgrounds.zip`);
  return included.length;
}
