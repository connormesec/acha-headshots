/** The one batch on this page: processing, edits, making files, saving to this browser. */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { PhotoError } from "../lib/decode";
import { loadDetectors } from "../lib/detect";
import { collect, type Picked } from "../lib/ingest";
import { zipName } from "../lib/names";
import { prepareItem } from "../lib/process";
import { renderHeadshot } from "../lib/render";
import { downloadBlob, writeZip } from "../lib/zipio";
import { applyPatch, withLook } from "./ops";
import { clearSaved, loadBlob, loadSaved, saveBatch, trySet, type SavedBatch } from "./persist";
import type { Batch, Headshot, HeadshotPatch, Item } from "./types";

export const DETECTOR_ERROR = "Couldn't load the face finder. Check your connection and reload.";

interface Ctx {
  batch: Batch | null;
  /** A batch saved in this browser from an earlier visit, not yet continued. */
  saved: { name: string; count: number } | null;
  storageFailed: boolean;
  backToCrops: boolean;
  setBackToCrops: (v: boolean) => void;
  start: (picked: Picked, name: string, onProgress?: (p: number) => void) => Promise<void>;
  resume: () => Promise<void>;
  update: (id: string, patch: HeadshotPatch) => Headshot;
  makeFiles: () => Promise<void>;
  download: () => void;
  clear: () => Promise<void>;
}

const BatchCtx = createContext<Ctx | null>(null);

export function useBatch(): Ctx {
  const ctx = useContext(BatchCtx);
  if (!ctx) throw new Error("useBatch must be used inside <BatchProvider>");
  return ctx;
}

type Action = { type: "set"; batch: Batch | null };
const reducer = (_: Batch | null, a: Action) => a.batch;

const nextFrame = () => new Promise((ok) => requestAnimationFrame(() => ok(undefined)));
const newId = () => crypto.randomUUID();

export function BatchProvider({ children }: { children: ReactNode }) {
  const [batch, dispatch] = useReducer(reducer, null);
  const current = useRef<Batch | null>(null); // always the latest batch, for async loops and update()
  const originals = useRef(new Map<string, Blob>());
  const [saved, setSaved] = useState<Ctx["saved"]>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [backToCrops, setBackToCrops] = useState(false);
  const savedRaw = useRef<SavedBatch | null>(null);

  const commit = useCallback((next: Batch | null) => {
    current.current = next;
    dispatch({ type: "set", batch: next });
  }, []);
  /** Apply a change to the latest batch (safe across awaits). */
  const change = useCallback((fn: (b: Batch) => Batch) => {
    if (current.current) commit(fn(current.current));
  }, [commit]);
  const changeItem = useCallback((id: string, patch: Partial<Item>) => {
    change((b) => ({ ...b, items: b.items.map((i) => (i.id === id ? withLook({ ...i, ...patch }) : i)) }));
  }, [change]);

  const store = useCallback(async (key: string, value: unknown) => {
    if (!(await trySet(key, value))) setStorageFailed(true);
  }, []);

  // ---------------------------------------------------------------- saving
  useEffect(() => {
    void loadSaved().then((s) => {
      if (s && !current.current) {
        savedRaw.current = s;
        setSaved({ name: s.name, count: s.items.length });
      }
    });
  }, []);

  useEffect(() => {
    if (!batch) return;
    const t = setTimeout(() => {
      void saveBatch(batch).then((ok) => ok || setStorageFailed(true));
    }, 300);
    return () => clearTimeout(t);
  }, [batch]);

  // ---------------------------------------------------------------- processing
  const processPending = useCallback(async () => {
    try {
      await loadDetectors();
    } catch {
      change((b) => ({ ...b, error_message: DETECTOR_ERROR }));
      return;
    }
    change((b) => ({ ...b, error_message: null }));
    for (const item of current.current?.items ?? []) {
      if (!current.current) return; // cleared meanwhile
      if (item.status !== "PENDING") continue;
      const original = originals.current.get(item.id);
      try {
        if (!original) throw new PhotoError("This photo wasn't saved in this browser. Add it again.");
        const { previewBlob, ...prepared } = await prepareItem(original, item.output_name);
        void store(`prev:${item.id}`, previewBlob);
        changeItem(item.id, prepared);
      } catch (e) {
        changeItem(item.id, {
          status: "FAILED", included: false,
          error_message: e instanceof PhotoError ? e.message : "Something went wrong with this photo",
        });
      }
      change((b) => ({ ...b, processed: b.items.filter((i) => i.status !== "PENDING").length }));
      await nextFrame(); // keep the page responsive
    }
    change((b) => (b.status === "PROCESSING" ? { ...b, status: "READY" } : b));
  }, [change, changeItem, store]);

  const start = useCallback<Ctx["start"]>(async (picked, name, onProgress) => {
    const { photos, skipped } = await collect(picked, onProgress);
    await clearSaved();
    savedRaw.current = null;
    setSaved(null);
    originals.current = new Map();
    const items: Item[] = photos.map((p) => {
      const id = newId();
      originals.current.set(id, p.blob);
      return {
        id, original_filename: p.path.split("/").pop() ?? p.path, output_name: p.outputName,
        status: "PENDING", error_message: null, image_url: null, thumbnail_url: null,
        width: null, height: null, original_width: null, original_height: null,
        crop: null, crop_source: null, flags: [], faces: [], low_resolution: false,
        included: true, approved: false, needs_look: false, output_bytes: null,
        autoCrop: null, autoFlags: [], rendered: null,
      };
    });
    const fallback = picked.kind === "zip" ? picked.file.name.replace(/\.zip$/i, "") : `${photos.length} photos`;
    setBackToCrops(false);
    commit({
      id: newId(), name: name.trim().slice(0, 200) || fallback,
      status: items.length ? "PROCESSING" : "FAILED",
      items, skipped, processed: 0, compressed: 0, zip: null, created_at: new Date().toISOString(),
      error_message: items.length ? null : "We didn't find any photos we can use in that ZIP.",
    });
    for (const [id, blob] of originals.current) void store(`orig:${id}`, blob); // in the background
    if (items.length) void processPending();
  }, [commit, processPending, store]);

  const resume = useCallback(async () => {
    const s = savedRaw.current;
    if (!s) return;
    originals.current = new Map();
    const items: Item[] = [];
    for (const it of s.items) {
      const orig = await loadBlob(`orig:${it.id}`);
      if (orig) originals.current.set(it.id, orig);
      const prev = it.status === "READY" ? await loadBlob(`prev:${it.id}`) : undefined;
      const out = it.output_bytes != null ? await loadBlob(`out:${it.id}`) : undefined;
      const url = prev ? URL.createObjectURL(prev) : null;
      let item: Item = {
        ...it, image_url: url, thumbnail_url: url,
        rendered: out ? { blob: out, bytes: out.size } : null, output_bytes: out ? out.size : null,
      };
      // A preview that didn't survive: prepare the photo again from its original.
      if (it.status === "READY" && !prev) item = { ...item, status: "PENDING" };
      items.push(withLook(item));
    }
    let b: Batch = { ...s, items, zip: null };
    const pending = items.some((i) => i.status === "PENDING");
    if (pending) b = { ...b, status: "PROCESSING" };
    else if (b.status === "PROCESSING") b = { ...b, status: "READY" };
    if (b.status === "COMPRESSING") b = { ...b, status: "READY", error_message: "Making files was interrupted. Try again." };
    if (b.status === "COMPRESSED") {
      const included = items.filter((i) => i.status === "READY" && i.included);
      if (included.every((i) => i.rendered)) {
        b = { ...b, zip: await writeZip(included.map((i) => ({ name: i.output_name, blob: i.rendered!.blob }))) };
      } else b = { ...b, status: "READY" };
    }
    savedRaw.current = null;
    setSaved(null);
    setBackToCrops(false);
    commit(b);
    if (pending) void processPending();
  }, [commit, processPending]);

  // ---------------------------------------------------------------- edits
  const update = useCallback<Ctx["update"]>((id, patch) => {
    if (!current.current) throw new Error("There's no batch open");
    const next = applyPatch(current.current, id, patch); // throws a user-facing message
    commit(next);
    return next.items.find((i) => i.id === id)!;
  }, [commit]);

  // ---------------------------------------------------------------- make files
  const makeFiles = useCallback(async () => {
    const b = current.current;
    if (!b || (b.status !== "READY" && b.status !== "COMPRESSED")) return;
    const included = b.items.filter((i) => i.status === "READY" && i.included);
    if (!included.length) {
      change((x) => ({ ...x, error_message: "Every photo is left out. Include at least one to make files." }));
      return;
    }
    setBackToCrops(false);
    change((x) => ({ ...x, status: "COMPRESSING", compressed: 0, error_message: null, zip: null }));
    for (const item of included) {
      const latest = current.current?.items.find((i) => i.id === item.id);
      if (!latest) return; // cleared meanwhile
      if (!latest.rendered) {
        try {
          const original = originals.current.get(item.id);
          if (!original) throw new PhotoError("This photo wasn't saved in this browser. Add it again.");
          const blob = await renderHeadshot(original, latest.crop!);
          changeItem(item.id, { rendered: { blob, bytes: blob.size }, output_bytes: blob.size });
          void store(`out:${item.id}`, blob);
        } catch (e) {
          const why = e instanceof PhotoError ? e.message : "Something went wrong with this photo.";
          change((x) => ({ ...x, status: "READY", error_message: `${latest.output_name}: ${why}` }));
          return;
        }
      }
      change((x) => ({ ...x, compressed: x.compressed + 1 }));
      await nextFrame();
    }
    const done = current.current;
    if (!done) return;
    const files = done.items
      .filter((i) => i.status === "READY" && i.included && i.rendered)
      .map((i) => ({ name: i.output_name, blob: i.rendered!.blob }));
    const zip = await writeZip(files);
    change((x) => ({ ...x, status: "COMPRESSED", zip }));
  }, [change, changeItem, store]);

  const download = useCallback(() => {
    const b = current.current;
    if (b?.zip) downloadBlob(b.zip, zipName(b.name));
  }, []);

  const clear = useCallback(async () => {
    for (const i of current.current?.items ?? []) if (i.image_url) URL.revokeObjectURL(i.image_url);
    originals.current = new Map();
    savedRaw.current = null;
    setSaved(null);
    setBackToCrops(false);
    commit(null);
    await clearSaved();
  }, [commit]);

  const value = useMemo<Ctx>(() => ({
    batch, saved, storageFailed, backToCrops, setBackToCrops, start, resume, update, makeFiles, download, clear,
  }), [batch, saved, storageFailed, backToCrops, start, resume, update, makeFiles, download, clear]);

  return <BatchCtx.Provider value={value}>{children}</BatchCtx.Provider>;
}
