/** How well the browser's appearance model separates our team from everyone else in a game
 * ("Pick your jersey"), on the old Python app's reviewed batches. Port of the second half of
 * devtools/appearance_eval.py; also scores the old app's stored embeddings for comparison.
 *
 *   npx tsx scripts/eval-appearance.ts <path/to/photo_ai.db> <path/to/storage>
 *
 * Reads only; prints numbers. AUC 1.0 = perfect separation, 0.5 = coin flip. */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { APPEARANCE_MODEL, embed } from "../src/ml/embed/appearance";

const [dbPath, storage] = process.argv.slice(2);
if (!dbPath || !storage) {
  console.error("usage: npx tsx scripts/eval-appearance.ts <photo_ai.db> <storage dir>");
  process.exit(2);
}
const session = await ort.InferenceSession.create(`node_modules/.cache/models/${APPEARANCE_MODEL}`);
const run = async (input: { data: Float32Array; dims: readonly number[] }) => {
  const out = await session.run({ pixel_values: new ort.Tensor("float32", input.data, input.dims as number[]) });
  const t = out[session.outputNames[0]];
  return { data: t.data as Float32Array, dims: t.dims };
};

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(`
  select d.id, d.resolution_status s, d.crop_path c, d.appearance_embedding e, p.job_id job
  from player_detections d join photos p on p.id = d.photo_id
  where d.crop_path is not null and d.crop_path != p.normalized_path
    and d.resolution_status in ('AUTO_ACCEPTED', 'CONFIRMED', 'REJECTED', 'FILTERED')
`).all() as { id: number; s: string; c: string; e: Uint8Array | null; job: string }[];

const dot = (a: Float32Array, b: Float32Array) => a.reduce((t, x, i) => t + x * b[i], 0);
const topMean = (xs: number[], k = 3) => { const s = [...xs].sort((a, b) => b - a).slice(0, k); return s.reduce((t, x) => t + x, 0) / s.length; };
function auc(pos: number[], neg: number[]) {
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

const ours: Record<string, Float32Array> = {}, old: Record<string, Float32Array | null> = {};
for (const r of rows) {
  const { data, info } = await sharp(join(storage, r.c)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  ours[r.id] = await embed({ data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }, run);
  old[r.id] = r.e ? new Float32Array(r.e.buffer.slice(r.e.byteOffset, r.e.byteOffset + r.e.byteLength)) : null;
}

for (const job of [...new Set(rows.map((r) => r.job))]) {
  const pos = rows.filter((r) => r.job === job && (r.s === "AUTO_ACCEPTED" || r.s === "CONFIRMED"));
  const neg = rows.filter((r) => r.job === job && (r.s === "REJECTED" || r.s === "FILTERED"));
  if (pos.length < 3 || neg.length < 2) continue;
  const score = (vecs: Record<string, Float32Array | null>) => {
    if ([...pos, ...neg].some((r) => !vecs[r.id])) return null;
    const p = pos.map((r) => topMean(pos.filter((o) => o.id !== r.id).map((o) => dot(vecs[r.id]!, vecs[o.id]!))));
    const n = neg.map((r) => topMean(pos.map((o) => dot(vecs[r.id]!, vecs[o.id]!))));
    return auc(p, n);
  };
  const a = score(ours), b = score(old);
  console.log(`batch ${job.slice(0, 8)}: ${pos.length} ours vs ${neg.length} others · browser DINOv2 AUC ${a!.toFixed(3)}${b === null ? "" : ` · old app AUC ${b.toFixed(3)}`}`);
}
