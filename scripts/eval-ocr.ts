/** Measures the browser number reader against real crops from the old Python app's database:
 * every detection a reviewer confirmed (or the old app auto-accepted) is ground truth, and the old
 * app's own EasyOCR readings are the baseline.
 *
 *   npx tsx scripts/eval-ocr.ts <path/to/photo_ai.db> <path/to/storage> [threshold]
 *
 * Reads only; prints numbers, never writes or copies photos. Needs Node 22.5+ (node:sqlite). */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { readNumbers, type RunModel } from "../src/ml/ocr/reader";
import type { RGBAImage } from "../src/ml/ocr/image";

const [dbPath, storage, thresholdArg] = process.argv.slice(2);
if (!dbPath || !storage) {
  console.error("usage: npx tsx scripts/eval-ocr.ts <photo_ai.db> <storage dir> [threshold]");
  process.exit(2);
}
const threshold = Number(thresholdArg ?? 0.85);

const sessions = {
  det: await ort.InferenceSession.create("node_modules/.cache/models/ppocrv6_small_det.onnx"),
  rec: await ort.InferenceSession.create("node_modules/.cache/models/ppocrv6_small_rec.onnx"),
};
const run: RunModel = async (model, input) => {
  const s = sessions[model];
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input.data, input.dims as number[]) });
  const t = out[s.outputNames[0]];
  return { data: t.data as Float32Array, dims: t.dims };
};

async function load(key: string): Promise<RGBAImage> {
  const { data, info } = await sharp(join(storage, key)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(`
  select d.id, d.resolution_status as status, d.jersey_crop_path as jersey, d.upper_crop_path as upper, p.jersey_number as truth
  from player_detections d
  join player_matches m on m.detection_id = d.id and m.status in ('AUTO_ACCEPTED', 'CONFIRMED')
  join players p on p.id = m.player_id
  where d.resolution_status in ('AUTO_ACCEPTED', 'CONFIRMED') and d.jersey_crop_path is not null and p.jersey_number is not null
`).all() as { id: number; status: string; jersey: string; upper: string; truth: number }[];
const easy = db.prepare(`select number, max(confidence) as c from jersey_observations where detection_id = ? and source = 'OCR' group by number order by c desc limit 1`);

let oursRight = 0, oursWrong = 0, oursAny = 0, easyRight = 0, easyWrong = 0;
const started = Date.now();
for (const r of rows) {
  const readings = await readNumbers([{ region: "jersey", image: await load(r.jersey) }, { region: "upper_body", image: await load(r.upper) }], run);
  const top = readings[0];
  if (readings.some((x) => x.number === r.truth)) oursAny++;
  if (top && top.confidence >= threshold) top.number === r.truth ? oursRight++ : oursWrong++;
  const e = easy.get(r.id) as { number: number; c: number } | undefined;
  if (e && e.c >= threshold) e.number === r.truth ? easyRight++ : easyWrong++;
  if (process.env.VERBOSE) console.log(r.id, r.status, "truth", r.truth, "ours", top ? `${top.number}@${top.confidence}` : "-", "easyocr", e ? `${e.number}@${e.c.toFixed(2)}` : "-");
}
const n = rows.length;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
console.log(`${n} players with a known number, threshold ${threshold}, ${((Date.now() - started) / n).toFixed(0)} ms/player`);
console.log(`browser reader: confident & right ${oursRight} (${pct(oursRight, n)} recall), confident & wrong ${oursWrong} (precision ${pct(oursRight, oursRight + oursWrong)}), right number anywhere ${pct(oursAny, n)}`);
console.log(`EasyOCR (old):  confident & right ${easyRight} (${pct(easyRight, n)} recall), confident & wrong ${easyWrong} (precision ${pct(easyRight, easyRight + easyWrong)})`);
