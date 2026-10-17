import { drawRegion, toJpeg } from "./canvas";
import { decodeImage, PhotoError } from "./decode";
import { cropPixels, type Crop } from "./geometry";

export interface OutputSize { width: number; height: number; maxBytes: number }

/** Crop the full-size original and return an exactly width×height JPEG under maxBytes. */
export async function renderCrop(original: Blob, crop: Crop, out: OutputSize): Promise<Blob> {
  const bmp = await decodeImage(original);
  try {
    const { left, top, width, height } = cropPixels(crop, bmp.width, bmp.height, out.width / out.height);
    return await encodeUnder(drawRegion(bmp, left, top, width, height, out.width, out.height), out.maxBytes);
  } finally {
    bmp.close();
  }
}

/** Highest JPEG quality (stepping down by 0.04) that fits. Canvas writes no EXIF/GPS metadata. */
export async function encodeUnder(c: HTMLCanvasElement, maxBytes: number, start = 0.92, floor = 0.5): Promise<Blob> {
  for (let q = start; ; q = Math.max(floor, q - 0.04)) {
    const blob = await toJpeg(c, q);
    if (blob.size <= maxBytes) return blob;
    if (q <= floor) throw new PhotoError("This photo couldn't be made small enough. Try a different photo.");
  }
}
