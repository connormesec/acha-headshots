/** Appearance embeddings for "Pick your jersey": DINOv2 ViT-S/14 (the model family the old app
 * used through timm), int8, 224 px. A person crop -> an L2-normalised 384-number vector; people
 * in the same uniform score close to each other. Environment-agnostic (the caller supplies run). */

import { crop, resize, scaleTo, type RGBAImage } from "../ocr/image";
import type { Tensor } from "../ocr/reader";

export const APPEARANCE_MODEL = "dinov2_small_int8.onnx";
const SHORT = 256, SIZE = 224; // resize the short side, then centre-crop (as the model's preprocessor does)
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

export function preprocess(img: RGBAImage): Tensor {
  const s = SHORT / Math.min(img.width, img.height);
  const w = Math.max(SIZE, Math.round(img.width * s)), h = Math.max(SIZE, Math.round(img.height * s));
  const scaled = s < 1 ? scaleTo(img, w, h) : resize(img, w, h);
  const c = crop(scaled, Math.floor((w - SIZE) / 2), Math.floor((h - SIZE) / 2), SIZE, SIZE);
  const plane = SIZE * SIZE;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let k = 0; k < 3; k++) data[k * plane + i] = (c.data[i * 4 + k] / 255 - MEAN[k]) / STD[k];
  }
  return { data, dims: [1, 3, SIZE, SIZE] };
}

/** The class token of the last (layer-normed) hidden state, L2-normalised. */
export function embeddingFrom(out: Tensor): Float32Array {
  const dim = out.dims[2];
  const v = Float32Array.from(out.data.subarray(0, dim));
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.max(Math.sqrt(n), 1e-12);
  return v.map((x) => x / n);
}

export async function embed(img: RGBAImage, run: (input: Tensor) => Promise<Tensor>): Promise<Float32Array> {
  return embeddingFrom(await run(preprocess(img)));
}
