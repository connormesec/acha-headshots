/** Builds the export ZIP in the browser: one folder per player with the original photos, a NEEDS
 * REVIEW and an UNIDENTIFIED folder, and manifest.csv. Where the browser allows, it's written
 * straight to a file on disk, so a big game never has to fit in memory. */

import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { downloadBlob } from "../../../lib/zipio";
import { SourceReader } from "../pipeline/sources";
import type { JobView } from "../view";
import { manifestCsv, planExport } from "./exportPlan";

export const exportName = (jobName: string) => `${jobName.replace(/[^A-Za-z0-9 _-]/g, "_").trim() || "photos"} - sorted.zip`;

type SaveFilePicker = (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

/** Writes the ZIP. Returns false if the user cancelled the save dialog. */
export async function exportJob(view: JobView, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  const rows = planExport(view.photos, view.detections, view.players);
  const photos = new Map(view.photos.map((p) => [p.id, p]));
  const filename = exportName(view.job.name);

  // Automated browsers (the e2e tests) can't answer a save dialog: they get a normal download.
  const picker = navigator.webdriver ? undefined : (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  let writer: BlobWriter | WritableStream<Uint8Array>;
  let blobWriter: BlobWriter | null = null;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: [{ description: "ZIP file", accept: { "application/zip": [".zip"] } }] });
      writer = await handle.createWritable();
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      blobWriter = new BlobWriter("application/zip");
      writer = blobWriter;
    }
  } else {
    blobWriter = new BlobWriter("application/zip");
    writer = blobWriter;
  }

  // Photos are already compressed: store them as they are (fast, and ZIP64 for big games).
  const zip = new ZipWriter(writer, { level: 0, zip64: true, useWebWorkers: false });
  const sources = new SourceReader();
  const inZip = rows.filter((r) => r.folder !== null);
  let done = 0;
  let current = null as { id: string; blob: Blob } | null; // rows are grouped by photo: read each original once
  for (const row of inZip) {
    if (current?.id !== row.photoId) current = { id: row.photoId, blob: await sources.original(photos.get(row.photoId)!) };
    await zip.add(`export/${row.folder}/${row.photo}`, new BlobReader(current.blob));
    onProgress?.(++done, inZip.length);
  }
  const playerKey = (r: { playerId?: string }) => (r.playerId ? view.players.get(r.playerId)?.externalId ?? r.playerId : "");
  await zip.add("export/manifest.csv", new TextReader(manifestCsv(rows, playerKey)), { level: 6 });
  await zip.close();
  if (blobWriter) downloadBlob(await blobWriter.getData(), filename);
  return true;
}
