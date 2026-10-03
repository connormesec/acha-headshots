import { MAX_PIXELS } from "./constants";
import { sniff } from "./formats";

/** The message is shown to the user as-is. */
export class PhotoError extends Error {}

const DAMAGED = "This file couldn't be opened. It may be damaged, or not really a photo.";
export const TOO_BIG = "This photo is too large to process. Resize it below 100 megapixels and add it again.";

const native = (blob: Blob) => createImageBitmap(blob, { imageOrientation: "from-image" }); // applies EXIF rotation

/** Any supported photo to an upright bitmap. The caller must close() it. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  const kind = await sniff(blob);
  if (kind === "unknown") throw new PhotoError(DAMAGED);
  let bmp: ImageBitmap;
  try {
    if (kind === "tiff") bmp = await decodeTiff(blob);
    else if (kind === "heic") {
      try {
        bmp = await native(blob);
      } catch {
        // Only Safari decodes HEIC natively. The csp build avoids eval, so our CSP can stay strict.
        const { heicTo } = await import("heic-to/csp");
        bmp = await native(await heicTo({ blob, type: "image/jpeg", quality: 0.95 }));
      }
    } else bmp = await native(blob);
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    throw new PhotoError(DAMAGED);
  }
  if (bmp.width * bmp.height > MAX_PIXELS) {
    bmp.close();
    throw new PhotoError(TOO_BIG);
  }
  return bmp;
}

async function decodeTiff(blob: Blob): Promise<ImageBitmap> {
  const UTIF = await import("utif2");
  const buf = await blob.arrayBuffer();
  const [page] = UTIF.decode(buf);
  if (!page) throw new PhotoError(DAMAGED);
  // Check the size from the tags (ImageWidth 256, ImageLength 257) before decoding any pixels.
  const tag = (t: string) => Number((page[t] as number[] | undefined)?.[0] ?? 0);
  if (tag("t256") * tag("t257") > MAX_PIXELS) throw new PhotoError(TOO_BIG);
  UTIF.decodeImage(buf, page);
  const w = page.width as number, h = page.height as number;
  const rgba = UTIF.toRGBA8(page);
  return createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h));
}
