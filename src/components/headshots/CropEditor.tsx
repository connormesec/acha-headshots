import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { HEAD_ABOVE_FACE } from "../../lib/crop";
import { useBatch } from "../../state/BatchContext";
import type { Crop, Headshot, HeadshotPatch, Item } from "../../state/types";
import { ErrorNote } from "../ui";
import { CropPreview } from "./CropPreview";
import { lookReasons } from "./HeadshotCard";
import { Modal } from "./Modal";
import { NameField } from "./NameField";

const ASPECT = 2 / 3; // width / height of the output
const HEAD_GUIDE = 0.1; // where the top of the head should sit (matches the auto framing)

type Corner = "nw" | "ne" | "sw" | "se";
type DragState = { mode: "move" | Corner; x0: number; y0: number; start: Crop; rect: DOMRect; moved: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Add ?debug to the page URL to see what the detectors found (for tuning the framing). */
const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

/** Raw detections (before filtering): faces in yellow, people in cyan, and the estimated top of
 * each head (face top − HEAD_ABOVE_FACE × face height) as a dashed line. */
function DebugOverlay({ item }: { item: Headshot }) {
  const d = (item as Item).debug;
  const W = item.width ?? 1, H = item.height ?? 1;
  if (!d) return null;
  const pos = (b: { x: number; y: number; width: number; height: number }) =>
    ({ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.width / W) * 100}%`, height: `${(b.height / H) * 100}%` });
  return (
    <div className="editor__debug" aria-hidden="true">
      {d.persons.map((p, i) => <span key={`p${i}`} className="editor__debug-person" style={pos(p)} />)}
      {d.faces.map((f, i) => (
        <Fragment key={`f${i}`}>
          <span className="editor__debug-face" style={pos(f)} />
          <span className="editor__debug-head" style={{ ...pos(f), top: `${((f.y - HEAD_ABOVE_FACE * f.height) / H) * 100}%`, height: 0 }} />
        </Fragment>
      ))}
    </div>
  );
}

/** Drag the box to move it, drag a corner (or use the slider) to zoom. Always 2:3. */
export function CropEditor({ item, onClose, onChanged }: {
  item: Headshot;
  onClose: () => void;
  onChanged: (item: Headshot) => void;
}) {
  const { update } = useBatch();
  const W = item.width ?? 1;
  const H = item.height ?? 1;
  const wToH = (W / H) / ASPECT; // crop.h = crop.w * wToH (both as fractions)
  const maxW = Math.min(1, 1 / wToH);
  const minW = Math.min(maxW, Math.max(0.04, 150 / (item.original_width ?? 1000)));

  const [crop, setCrop] = useState<Crop>(item.crop ?? { x: 0, y: 0, w: maxW, h: maxW * wToH });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const drag = useRef<DragState | null>(null);

  const dirty =
    !item.crop || ["x", "y", "w"].some((k) => Math.abs(crop[k as keyof Crop] - item.crop![k as keyof Crop]) > 1e-4);

  const fit = (w: number, cx: number, cy: number): Crop => {
    w = clamp(w, minW, maxW);
    const h = w * wToH;
    return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
  };

  const onPointerDown = (mode: DragState["mode"]) => (e: PointerEvent<HTMLElement>) => {
    const stage = (e.currentTarget.closest(".editor__stage") as HTMLElement).getBoundingClientRect();
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, y0: e.clientY, start: crop, rect: stage, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    const dx = (e.clientX - d.x0) / d.rect.width;
    const dy = (e.clientY - d.y0) / d.rect.height;
    const s = d.start;
    if (d.mode === "move") {
      setCrop({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    const east = d.mode.includes("e");
    const south = d.mode.includes("s");
    const ax = east ? s.x : s.x + s.w; // the opposite corner stays put
    const ay = south ? s.y : s.y + s.h;
    const px = (east ? s.x + s.w : s.x) + dx;
    const py = (south ? s.y + s.h : s.y) + dy;
    let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) / wToH);
    const roomX = east ? 1 - ax : ax;
    const roomY = (south ? 1 - ay : ay) / wToH;
    w = clamp(w, minW, Math.min(maxW, roomX, roomY));
    const h = w * wToH;
    setCrop({ x: east ? ax : ax - w, y: south ? ay : ay - h, w, h });
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.mode !== "move") return;
    // A tap (no drag) on a detected face inside the box: crop around that face.
    const fx = (e.clientX - d.rect.left) / d.rect.width;
    const fy = (e.clientY - d.rect.top) / d.rect.height;
    const hit = item.faces.findIndex((f) => fx >= f.x && fx <= f.x + f.w && fy >= f.y && fy <= f.y + f.h);
    if (hit >= 0 && item.faces.length > 1) void send({ face_index: hit });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [mx, my] = moves[e.key];
      setCrop(fit(crop.w, cx + mx, cy + my));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setCrop(fit(crop.w * 0.95, cx, cy)); // zoom in = smaller box
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      setCrop(fit(crop.w * 1.05, cx, cy));
    }
  };

  const send = async (patch: HeadshotPatch, close = false) => {
    setSaving(true);
    setError(undefined);
    try {
      const updated = update(item.id, patch);
      onChanged(updated);
      if (updated.crop) setCrop(updated.crop);
      if (close) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const rename = async (name: string) => {
    onChanged(update(item.id, { output_name: name }));
  };

  const widthPx = Math.round(crop.w * (item.original_width ?? 0));
  const zoom = maxW === minW ? 0 : (maxW - crop.w) / (maxW - minW); // 0 = widest, 1 = tightest
  const reasons = item.crop_source === "manual" ? [] : lookReasons(item);
  const multipleFaces = item.faces.length > 1;

  return (
    <Modal title="Fix crop" onClose={onClose} wide>
      <div className="editor">
        <div>
          <p className="editor__tip">Drag to move. Drag a corner to zoom. Keep a little space above the head.</p>
          <div
            className="editor__stage"
            style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(62vh * ${W / H}))` }}
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label="Crop area. Arrow keys move the crop; plus and minus zoom."
          >
            <img src={item.image_url ?? undefined} alt="" draggable={false} />
            {DEBUG && <DebugOverlay item={item} />}
            <div
              className="editor__box"
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              onPointerDown={onPointerDown("move")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => (drag.current = null)}
            >
              <span className="editor__guide" style={{ top: `${HEAD_GUIDE * 100}%` }}><span>top of head</span></span>
              {(["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
                <span
                  key={c}
                  className={`editor__handle editor__handle--${c}`}
                  onPointerDown={onPointerDown(c)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => (drag.current = null)}
                />
              ))}
            </div>
            {item.faces.map((f, i) => (
              <button
                key={i}
                type="button"
                className="editor__face"
                style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                onClick={() => send({ face_index: i })}
                disabled={saving}
                title="Crop around this face"
                aria-label={`Crop around face ${i + 1}`}
              />
            ))}
          </div>
          <label className="editor__zoom">
            <span>Wider</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={zoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                setCrop(fit(maxW - z * (maxW - minW), crop.x + crop.w / 2, crop.y + crop.h / 2));
              }}
              aria-label="Zoom"
            />
            <span>Closer</span>
          </label>
        </div>

        <aside className="editor__side">
          <div className="field">
            <span className="field__label">File name</span>
            <NameField value={item.output_name} onSave={rename} />
          </div>

          <div>
            <span className="field__label">What ACHA will get</span>
            <CropPreview src={item.image_url} crop={crop} alt="Preview of the cropped headshot" className="editor__preview" />
            <p className="small muted">1000 × 1500, under 2 MB</p>
          </div>

          {reasons.length > 0 && !dirty && (
            <div className="note note--warn small">{reasons.map((r) => <div key={r}>{r}</div>)}</div>
          )}
          {multipleFaces && (
            <p className="small muted">We found {item.faces.length} faces. Click the right one in the photo to crop around it.</p>
          )}
          {widthPx > 0 && widthPx < 600 && (
            <div className="note note--warn small">This crop is only {widthPx} px wide, so it will look blurry. Zoom out if you can.</div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="editor__actions">
            <button type="button" className="button button--primary" onClick={() => send({ crop: { x: crop.x, y: crop.y, w: crop.w } }, true)} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save crop"}
            </button>
            <button type="button" className="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="button button--small hs-link" onClick={() => send({ reset: true })} disabled={saving}>
              Reset to automatic crop
            </button>
            {item.included && (
              <button type="button" className="button button--small hs-link" onClick={() => send({ included: false }, true)} disabled={saving}>
                Leave this photo out
              </button>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
