import { drawRegion, toJpeg } from "./canvas";
import { MAX_OUTPUT_BYTES, OUT_H, OUT_W } from "./constants";
import { cropPixels, type Crop } from "./crop";
import { decodeImage, PhotoError } from "./decode";

/** Crop the full-size original and return an exactly 1000×1500 JPEG under 2,000,000 bytes. */
export async function renderHeadshot(original: Blob, crop: Crop): Promise<Blob> {
  const bmp = await decodeImage(original);
  try {
    const { left, top, width, height } = cropPixels(crop, bmp.width, bmp.height);
    return await encodeUnder(drawRegion(bmp, left, top, width, height, OUT_W, OUT_H), MAX_OUTPUT_BYTES);
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
