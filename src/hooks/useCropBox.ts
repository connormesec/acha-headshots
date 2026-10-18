import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Crop } from "../lib/geometry";

type Corner = "nw" | "ne" | "sw" | "se";
export const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
type DragState = { mode: "move" | Corner; x0: number; y0: number; start: Crop; rect: DOMRect; moved: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A fixed-ratio crop box over an image (all values are fractions of the image).
 * Drag the box to move it, drag a corner (or use `zoom`) to resize; arrow keys and +/- too.
 * `onTap` gets the image-relative point of a click on the box that didn't drag. */
export function useCropBox({ width, height, aspect, minWidth, initial, onTap }: {
  width: number; // image size, any unit (only the ratio matters)
  height: number;
  aspect: number; // output width / height
  minWidth: number; // smallest crop width, as a fraction of the image
  initial: Crop | null;
  onTap?: (x: number, y: number) => void;
}) {
  const wToH = width / height / aspect; // crop.h = crop.w * wToH (both as fractions)
  const maxW = Math.min(1, 1 / wToH);
  const minW = Math.min(maxW, minWidth);
  const [crop, setCrop] = useState<Crop>(initial ?? { x: 0, y: 0, w: maxW, h: maxW * wToH });
  const drag = useRef<DragState | null>(null);

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
    if (!d || d.moved || d.mode !== "move" || !onTap) return;
    onTap((e.clientX - d.rect.left) / d.rect.width, (e.clientY - d.rect.top) / d.rect.height);
  };

  const onPointerCancel = () => (drag.current = null);

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

  const zoom = maxW === minW ? 0 : (maxW - crop.w) / (maxW - minW); // 0 = widest, 1 = tightest
  const setZoom = (z: number) => setCrop(fit(maxW - z * (maxW - minW), crop.x + crop.w / 2, crop.y + crop.h / 2));
  const dirtyFrom = (saved: Crop | null) =>
    !saved || (["x", "y", "w"] as const).some((k) => Math.abs(crop[k] - saved[k]) > 1e-4);

  /** Spread onto the box and each corner handle. */
  const handlers = (mode: DragState["mode"]) => ({
    onPointerDown: onPointerDown(mode),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  });

  return { crop, setCrop, zoom, setZoom, dirtyFrom, handlers, onKeyDown };
}
