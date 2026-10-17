/** What the user picked → the photos to process, plus what was skipped and why.
 * Port of zip_ingest.py and the file checks in HeadshotUpload.tsx. */

import type { Entry } from "@zip.js/zip.js";
import type { DragEvent } from "react";
import { MAX_FILE_BYTES, MAX_PHOTOS } from "./constants";
import { PHOTO_EXTENSIONS, sanitizeFilename, stemOf, uniqueOutputName } from "./names";
import { extract, readZip } from "./zipio";

export type Picked =
  | { kind: "zip"; file: File }
  | { kind: "photos"; files: File[]; skipped: Skipped[] };

export interface Skipped { name: string; reason: string }

export interface Candidate { path: string; outputName: string; blob: Blob }

const MB = 1024 * 1024;
const NOT_A_PHOTO = "not a photo we can use";
const TOO_BIG = `over ${MAX_FILE_BYTES / MB} MB. Export a smaller copy.`;
export const tooMany = (n: number, max: number) => `That's ${n} photos. The limit is ${max} per batch, so split them into smaller batches.`;

export const ext = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};
export const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
/** Silent skips: a path part starting with "." (incl. .DS_Store, ._a.jpg) or a __MACOSX folder. */
export const hiddenPath = (path: string) =>
  path.split("/").some((part) => part.startsWith(".") || part.toLowerCase() === "__macosx");
export const isHidden = (f: File) => hiddenPath(relPath(f));

export function formatSize(bytes: number): string {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Sort what the user chose into "one ZIP" or "these photos (and these will be skipped)". */
export function classify(all: File[], maxPhotos = MAX_PHOTOS): Picked | string {
  const files = all.filter((f) => !isHidden(f));
  if (!files.length) return "We didn't find any files there. Try choosing the photos themselves.";
  const zips = files.filter((f) => ext(f.name) === ".zip");
  if (zips.length > 1) return "Choose one ZIP at a time.";
  if (zips.length === 1 && files.length > 1) return "Choose either one ZIP, or the photos themselves. Not both at once.";
  if (zips.length === 1) return { kind: "zip", file: zips[0] };
  const photos: File[] = [];
  const skipped: Skipped[] = [];
  for (const f of files) {
    if (!PHOTO_EXTENSIONS.includes(ext(f.name))) skipped.push({ name: f.name, reason: NOT_A_PHOTO });
    else if (f.size > MAX_FILE_BYTES) skipped.push({ name: f.name, reason: TOO_BIG });
    else photos.push(f);
  }
  if (!photos.length) return "None of those files are photos. Choose JPG, PNG, HEIC, WebP, GIF, TIFF or BMP files, or a ZIP of them.";
  if (photos.length > maxPhotos) return tooMany(photos.length, maxPhotos);
  return { kind: "photos", files: photos, skipped };
}

/** Files from a drop, including everything inside dropped folders. */
export async function filesFromDrop(e: DragEvent): Promise<File[]> {
  const entries = Array.from(e.dataTransfer.items ?? [])
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null))
    .filter((x): x is FileSystemEntry => !!x);
  if (!entries.length) return Array.from(e.dataTransfer.files);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      // Keep the folder path so hidden-folder checks and the batch name still work.
      const path = entry.fullPath.replace(/^\//, "");
      if (path && path !== file.name) Object.defineProperty(file, "webkitRelativePath", { value: path });
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

export function defaultName(files: File[], picked: Picked): string {
  if (picked.kind === "zip") return picked.file.name.replace(/\.zip$/i, "");
  const rel = relPath(files[0]);
  return rel.includes("/") ? rel.split("/")[0] : "";
}

export const entryBase = (e: Entry) => e.filename.replace(/\\/g, "/").split("/").pop() ?? e.filename;

/** Why a ZIP entry can't be used ("hidden": skip it without a word), or null. The size and
 * compression-ratio limits stop ZIP bombs (port of zip_ingest.py). */
export function entryProblem(e: Entry): string | null {
  const path = e.filename.replace(/\\/g, "/");
  if (e.directory || hiddenPath(path)) return "hidden";
  if (!PHOTO_EXTENSIONS.includes(ext(entryBase(e)))) return NOT_A_PHOTO;
  if (e.encrypted) return "password-protected inside the ZIP";
  if (e.uncompressedSize > MAX_FILE_BYTES) return TOO_BIG;
  if (e.uncompressedSize / Math.max(1, e.compressedSize) > 200) return "looks damaged";
  return null;
}

/** Sorted by lowercase path, each with a unique output name. */
export function name<T extends { path: string }>(found: T[]): (T & { outputName: string })[] {
  const taken = new Set<string>();
  return [...found]
    .sort((a, b) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0))
    .map((f) => ({ ...f, outputName: uniqueOutputName(stemOf(sanitizeFilename(f.path)), taken) }));
}

/** Reads the picked files (and the ZIP's entries) into candidates. Throws a user-facing Error
 * when the batch can't start at all. `onProgress` gets 0..1. */
export async function collect(picked: Picked, onProgress?: (p: number) => void): Promise<{ photos: Candidate[]; skipped: Skipped[] }> {
  if (picked.kind === "photos") {
    onProgress?.(1);
    return { photos: name(picked.files.map((f) => ({ path: relPath(f), blob: f as Blob }))), skipped: picked.skipped };
  }
  const { reader, entries } = await readZip(picked.file);
  try {
    const skipped: Skipped[] = [];
    const accepted: Entry[] = [];
    for (const e of entries) {
      const why = entryProblem(e);
      if (why === "hidden") continue;
      if (why) skipped.push({ name: entryBase(e), reason: why });
      else accepted.push(e);
    }
    if (accepted.length > MAX_PHOTOS) throw new Error(tooMany(accepted.length, MAX_PHOTOS));
    const found: { path: string; blob: Blob }[] = [];
    for (const [i, e] of accepted.entries()) {
      try {
        found.push({ path: e.filename, blob: await extract(e) });
      } catch {
        skipped.push({ name: entryBase(e), reason: "looks damaged" });
      }
      onProgress?.((i + 1) / accepted.length);
    }
    return { photos: name(found), skipped };
  } finally {
    await reader.close().catch(() => {});
  }
}
