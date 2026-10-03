import { BlobReader, BlobWriter, ZipReader, ZipWriter, type Entry } from "@zip.js/zip.js";

/** Opens a ZIP. Close the reader once every accepted entry has been extracted. */
export async function readZip(file: Blob): Promise<{ reader: ZipReader<unknown>; entries: Entry[] }> {
  // Plain JS, no web workers: entries are photos and are mostly stored, not deflated.
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    return { reader, entries: await reader.getEntries() };
  } catch {
    await reader.close().catch(() => {});
    throw new Error("That file isn't a valid ZIP. Try re-creating it, or add the photos directly.");
  }
}

export async function extract(entry: Entry): Promise<Blob> {
  if (entry.directory) throw new Error("Not a file");
  return entry.getData(new BlobWriter());
}

export async function writeZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { level: 0, useWebWorkers: false });   // JPEGs don't compress
  for (const f of files) await w.add(f.name, new BlobReader(f.blob));
  return w.close();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
