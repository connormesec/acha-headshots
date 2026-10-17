import { MAX_OUTPUT_BYTES, OUT_H, OUT_W } from "../../../lib/constants";
import type { Crop } from "../../../lib/geometry";
import { renderCrop } from "../../../lib/render";

/** Crop the full-size original and return an exactly 1000×1500 JPEG under 2,000,000 bytes. */
export const renderHeadshot = (original: Blob, crop: Crop) =>
  renderCrop(original, crop, { width: OUT_W, height: OUT_H, maxBytes: MAX_OUTPUT_BYTES });
