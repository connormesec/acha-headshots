/** Saves work in this browser's IndexedDB so a refresh doesn't lose it. Nothing leaves the device.
 *
 * Keys: "batch" (JSON, no blobs or URLs), "orig:<id>", "prev:<id>", "out:<id>" (Blobs).
 * Every write may fail (quota, private mode): callers get `false` and carry on. */

import { clear, get, set } from "idb-keyval";
import type { Batch, Item } from "./types";

type SavedItem = Omit<Item, "rendered" | "image_url" | "thumbnail_url">;
export type SavedBatch = Omit<Batch, "zip" | "items"> & { items: SavedItem[] };

export async function trySet(key: string, value: unknown): Promise<boolean> {
  try {
    await set(key, value);
    return true;
  } catch {
    return false;
  }
}

export function saveBatch(batch: Batch): Promise<boolean> {
  const { zip: _zip, ...rest } = batch;
  const saved: SavedBatch = {
    ...rest,
    items: batch.items.map(({ rendered: _r, image_url: _i, thumbnail_url: _t, ...item }) => item),
  };
  return trySet("batch", saved);
}

export async function loadSaved(): Promise<SavedBatch | null> {
  try {
    return (await get<SavedBatch>("batch")) ?? null;
  } catch {
    return null;
  }
}

export async function loadBlob(key: string): Promise<Blob | undefined> {
  try {
    return await get<Blob>(key);
  } catch {
    return undefined;
  }
}

export async function clearSaved(): Promise<void> {
  try {
    await clear();
  } catch {
    /* nothing saved, or storage is unavailable */
  }
}
