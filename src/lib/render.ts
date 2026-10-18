import { drawRegion, makeCanvas, toJpeg } from "./canvas";
import { decodeImage, PhotoError } from "./decode";
import { cropPixels, type Crop } from "./geometry";

export interface OutputSize { width: number; height: number; maxBytes: number }

const TOO_BIG = "This photo couldn't be made small enough. Try a different photo.";

/** Crop the full-size original and return an exactly width×height JPEG under maxBytes. */
export async function renderCrop(original: Blob, crop: Crop, out: OutputSize): Promise<Blob> {
  const bmp = await decodeImage(original);
  let canvas: HTMLCanvasElement;
  try {
    const { left, top, width, height } = cropPixels(crop, bmp.width, bmp.height, out.width / out.height);
    canvas = drawRegion(bmp, left, top, width, height, out.width, out.height);
  } finally {
    bmp.close();
  }
  try {
    return await encodeUnder(canvas, out.maxBytes);
  } catch (e) {
    if (!(e instanceof PhotoError)) throw e;
    // Very grainy shots (high ISO) can't fit a small budget even at low quality. Soften the grain
    // a touch and try again: barely visible, and far smaller.
    for (const radius of [0.6, 1.2]) {
      const soft = softened(canvas, radius);
      if (!soft) break;
      try {
        return await encodeUnder(soft, out.maxBytes, 0.85);
      } catch (again) {
        if (!(again instanceof PhotoError)) throw again;
      }
    }
    throw e;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** A blurred copy, or null where canvas filters aren't supported. */
function softened(src: HTMLCanvasElement, radius: number): HTMLCanvasElement | null {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  if (!("filter" in ctx)) return null;
  ctx.drawImage(src, 0, 0); // underneath, so the blur doesn't fade the edges
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";
  return c;
}

/** Highest JPEG quality (stepping down by 0.04) that fits. Canvas writes no EXIF/GPS metadata. */
export async function encodeUnder(c: HTMLCanvasElement, maxBytes: number, start = 0.92, floor = 0.5): Promise<Blob> {
  for (let q = start; ; q = Math.max(floor, q - 0.04)) {
    const blob = await toJpeg(c, q);
    if (blob.size <= maxBytes) return blob;
    if (q <= floor) throw new PhotoError(TOO_BIG);
  }
}
