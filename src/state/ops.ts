/** Per-photo edits as pure functions. Port of the edit rules in headshot_service.py.
 * Each takes a batch and returns a new one; errors are thrown with a user-facing message. */

import { frameFace, isGenericName, normalizeCrop, resolutionFlags, SOFT_FLAGS, type Crop as CropBox } from "../lib/crop";
import { PHOTO_EXTENSIONS, sanitizeFilename } from "../lib/names";
import type { Batch, HeadshotFlag, HeadshotPatch, Item } from "./types";

export const needsLook = (i: Item) =>
  i.status === "READY" && i.included && !i.approved && i.flags.some((f) => !SOFT_FLAGS.has(f));

/** Keeps the derived `needs_look` field in step with the rest of the item. */
export const withLook = (i: Item): Item => {
  const look = needsLook(i);
  return i.needs_look === look ? i : { ...i, needs_look: look };
};

export function summary(batch: Batch) {
  const ready = batch.items.filter((i) => i.status === "READY");
  return {
    needs_look: ready.filter(needsLook).length,
    to_compress: ready.filter((i) => i.included).length,
    excluded: ready.filter((i) => !i.included).length,
    generic_names: ready.filter((i) => i.included && i.flags.includes("generic_name")).length,
  };
}

function find(batch: Batch, id: string): Item {
  const item = batch.items.find((i) => i.id === id);
  if (!item) throw new Error("That photo isn't in this batch");
  return item;
}

export function editable(batch: Batch, item: Item): void {
  if (batch.status === "PROCESSING" || batch.status === "COMPRESSING") {
    throw new Error("Please wait until the photos have finished processing");
  }
  if (item.status !== "READY") throw new Error("This photo couldn't be opened, so it can't be edited");
}

/** Any edit makes the made ZIP stale; the user makes new files from step 2. */
export function invalidate(batch: Batch): Batch {
  return { ...batch, zip: null, status: batch.status === "COMPRESSED" ? "READY" : batch.status };
}

export const keepSoft = (flags: HeadshotFlag[]) => flags.filter((f) => f === "generic_name");

const put = (batch: Batch, item: Item): Batch =>
  ({ ...batch, items: batch.items.map((i) => (i.id === item.id ? withLook(item) : i)) });

/** A human chose this crop: detection flags no longer apply; resolution still does. */
function applyManual(batch: Batch, item: Item, crop: CropBox): Batch {
  const res = resolutionFlags(crop, item.original_width!);
  return invalidate(put(batch, {
    ...item, crop, crop_source: "manual", low_resolution: res.length > 0,
    flags: [...keepSoft(item.flags), ...res], rendered: null, output_bytes: null,
  }));
}

export function setManualCrop(batch: Batch, id: string, x: number, y: number, w: number): Batch {
  const item = find(batch, id);
  editable(batch, item);
  return applyManual(batch, item, normalizeCrop(x, y, w, item.width!, item.height!));
}

export function frameOnFace(batch: Batch, id: string, index: number): Batch {
  const item = find(batch, id);
  editable(batch, item);
  const f = item.faces[index];
  if (!Number.isInteger(index) || !f) throw new Error("That face isn't in this photo");
  const W = item.width!, H = item.height!;
  const box = { x: Math.round(f.x * W), y: Math.round(f.y * H), width: Math.round(f.w * W), height: Math.round(f.h * H) };
  return applyManual(batch, item, frameFace(box, W, H));
}

export function resetCrop(batch: Batch, id: string): Batch {
  const item = find(batch, id);
  editable(batch, item);
  const auto = item.autoFlags.filter((f) => f !== "generic_name");
  const source = item.autoFlags.includes("not_headshot") ? "center" : item.autoFlags.includes("no_face") ? "person" : "face";
  return invalidate(put(batch, {
    ...item, crop: item.autoCrop, crop_source: source, approved: false,
    flags: [...keepSoft(item.flags), ...auto],
    low_resolution: auto.some((f) => f === "low_resolution" || f === "upscaled"),
    rendered: null, output_bytes: null,
  }));
}

export function approve(batch: Batch, id: string): Batch {
  const item = find(batch, id);
  editable(batch, item);
  return put(batch, { ...item, approved: true });
}

export function setIncluded(batch: Batch, id: string, included: boolean): Batch {
  const item = find(batch, id);
  editable(batch, item);
  if (item.included === included) return batch;
  return invalidate(put(batch, { ...item, included }));
}

const RENAME_EXTS = new Set(PHOTO_EXTENSIONS);

export function rename(batch: Batch, id: string, requested: string): Batch {
  const item = find(batch, id);
  editable(batch, item);
  let stem = requested.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = stem.lastIndexOf(".");
  if (dot >= 0 && RENAME_EXTS.has(stem.slice(dot).toLowerCase())) stem = stem.slice(0, dot); // output is always .jpg
  if (!stem.replace(/^[ ._]+|[ ._]+$/g, "")) throw new Error("Type a name for this photo");
  const name = `${sanitizeFilename(stem).slice(0, 150).replace(/[ .]+$/, "")}.jpg`;
  if (batch.items.some((o) => o.id !== id && o.output_name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Another photo is already named ${name}`);
  }
  if (name === item.output_name) return batch;
  const flags: HeadshotFlag[] = item.flags.filter((f) => f !== "generic_name");
  if (isGenericName(name)) flags.push("generic_name");
  // The rendered JPEG doesn't depend on the name, so it's kept.
  return invalidate(put(batch, { ...item, output_name: name, flags }));
}

/** Same call shape as the old api.updateHeadshot(id, patch). */
export function applyPatch(batch: Batch, id: string, patch: HeadshotPatch): Batch {
  if ("crop" in patch) return setManualCrop(batch, id, patch.crop.x, patch.crop.y, patch.crop.w);
  if ("reset" in patch) return resetCrop(batch, id);
  if ("face_index" in patch) return frameOnFace(batch, id, patch.face_index);
  if ("approved" in patch) return approve(batch, id);
  if ("included" in patch) return setIncluded(batch, id, patch.included);
  if ("output_name" in patch) return rename(batch, id, patch.output_name);
  throw new Error("Unknown change");
}
