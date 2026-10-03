/** Prepare one photo: decode, preview, detect, auto-crop, flag. Port of HeadshotProcessor._crop_one. */

import type { Item } from "../state/types";
import { drawScaled, toJpeg } from "./canvas";
import { PREVIEW_MAX_SIDE } from "./constants";
import { assess, isGenericName, resolutionFlags, type Flag } from "./crop";
import { decodeImage } from "./decode";
import { detect } from "./detect";

export type Prepared = Partial<Item> & { previewBlob: Blob };

export async function prepareItem(original: Blob, outputName: string): Promise<Prepared> {
  const bmp = await decodeImage(original); // throws PhotoError over MAX_PIXELS
  let preview: HTMLCanvasElement;
  const originalW = bmp.width, originalH = bmp.height;
  try {
    preview = drawScaled(bmp, PREVIEW_MAX_SIDE);
  } finally {
    bmp.close();   // never keep full-size bitmaps around: phones run out of memory
  }
  try {
    const { faces, persons } = await detect(preview);
    const a = assess(faces, persons, preview.width, preview.height);
    const res = resolutionFlags(a.crop, originalW);
    const autoFlags: Flag[] = [...a.flags, ...res];
    const flags: Flag[] = [...autoFlags, ...(isGenericName(outputName) ? (["generic_name"] as Flag[]) : [])];
    const previewBlob = await toJpeg(preview, 0.9);
    const url = URL.createObjectURL(previewBlob);
    return {
      status: "READY", image_url: url, thumbnail_url: url,
      width: preview.width, height: preview.height, original_width: originalW, original_height: originalH,
      crop: a.crop, crop_source: a.source, flags, faces: a.faces, low_resolution: res.length > 0,
      autoCrop: a.crop, autoFlags, previewBlob, debug: { faces, persons },
    };
  } finally {
    preview.width = 0; preview.height = 0;
  }
}
