/** Reads original photos back from what was added: a stored ZIP (one entry at a time) or a stored
 * photo. ZIPs stay as one blob in the browser's database, so a big game isn't copied twice. */

import { BlobReader, BlobWriter, ZipReader, type Entry } from "@zip.js/zip.js";
import { getBlob } from "../../../db/repo";
import type { Photo } from "../types";

export class SourceReader {
  private zips = new Map<string, Promise<Map<string, Entry>>>();

  constructor(private readonly load: (key: string) => Promise<Blob | undefined> = getBlob) {}

  private entries(key: string): Promise<Map<string, Entry>> {
    let p = this.zips.get(key);
    if (!p) {
      p = (async () => {
        const blob = await this.load(key);
        if (!blob) throw new Error("This photo's upload isn't saved in this browser any more. Add it again.");
        const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
        return new Map((await reader.getEntries()).map((e) => [e.filename, e]));
      })();
      p.catch(() => this.zips.delete(key));
      this.zips.set(key, p);
    }
    return p;
  }

  async original(photo: Photo): Promise<Blob> {
    const { blob: key, entry } = photo.source;
    if (entry === undefined) {
      const blob = await this.load(key);
      if (!blob) throw new Error("This photo isn't saved in this browser any more. Add it again.");
      return blob;
    }
    const e = (await this.entries(key)).get(entry);
    if (!e || e.directory) throw new Error("This photo is missing from the ZIP");
    return e.getData(new BlobWriter());
  }
}
