/** Appearance embeddings in the browser, for "Pick your jersey". Each person's stored crop is
 * embedded once; the vector is saved on the person, so it's instant next time. */

import { getBlob } from "../db/repo";
import { MOCK_CV } from "../features/sorting/pipeline/browserProviders";
import type { Detection } from "../features/sorting/types";
import { APPEARANCE_MODEL, embed } from "./embed/appearance";
import { normalizeRow } from "../features/sorting/resolution/jerseyMatch";
import type { RGBAImage } from "./ocr/image";
import { runOnce, session } from "./ort";

export const EMBEDDING_NAME = MOCK_CV ? "mock-mean-colour" : "dinov2-small-int8-224";
export const loadAppearance = () => (MOCK_CV ? Promise.resolve() : session(APPEARANCE_MODEL).then(() => undefined));

async function pixels(blob: Blob): Promise<RGBAImage> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
  c.width = c.height = 0;
  return img;
}

/** Mock (?mockcv): the crop's mean colour, centred, so same-colour jerseys score ~1 (port of
 * embedding/mock.py). */
function meanColour(img: RGBAImage): Float32Array {
  const sum = [0, 0, 0];
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) sum[k] += img.data[i * 4 + k];
  return normalizeRow(Float32Array.from(sum.map((s) => s / n / 255 - 0.5 + 1e-3)));
}

/** Embeddings for `people` (computing the missing ones). Returns the updated people too. */
export async function ensureEmbeddings(people: Detection[], onProgress?: (done: number, total: number) => void):
  Promise<{ vectors: Float32Array[]; updated: Detection[] }> {
  const missing = people.filter((d) => !d.embedding || d.embeddingModel !== EMBEDDING_NAME);
  const updated: Detection[] = [];
  const fresh = new Map<string, Float32Array>();
  let done = 0;
  for (const d of missing) {
    const blob = await getBlob(`crop:${d.id}`);
    const img = blob ? await pixels(blob) : { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const v = MOCK_CV ? meanColour(img) : await embed(img, (input) => runOnce(APPEARANCE_MODEL, input));
    fresh.set(d.id, v);
    updated.push({ ...d, embedding: v, embeddingModel: EMBEDDING_NAME });
    onProgress?.(++done, missing.length);
  }
  return { vectors: people.map((d) => fresh.get(d.id) ?? d.embedding!), updated };
}
