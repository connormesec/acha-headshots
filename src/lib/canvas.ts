export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";            // transparent PNG/GIF areas become white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  return c;
}

/** Draw a source region at a new size. Halves in steps first so big reductions stay sharp. */
export function drawRegion(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
                           dw: number, dh: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  while (sw > dw * 2) {
    const w = Math.round(sw / 2), h = Math.round(sh / 2);
    const step = makeCanvas(w, h);
    step.getContext("2d")!.drawImage(cur, sx, sy, sw, sh, 0, 0, w, h);
    if (cur !== src) release(cur);
    cur = step; sx = 0; sy = 0; sw = w; sh = h;
  }
  const out = makeCanvas(dw, dh);
  out.getContext("2d")!.drawImage(cur, sx, sy, sw, sh, 0, 0, dw, dh);
  if (cur !== src) release(cur);
  return out;
}

/** Free an intermediate canvas's pixels now (Safari counts canvas memory against a hard limit). */
function release(c: CanvasImageSource) {
  if (c instanceof HTMLCanvasElement) { c.width = 0; c.height = 0; }
}

export function drawScaled(src: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  return drawRegion(src, 0, 0, src.width, src.height, Math.round(src.width * s), Math.round(src.height * s));
}

export const toJpeg = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("JPEG encode failed"))), "image/jpeg", quality));
