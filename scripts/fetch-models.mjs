/** Downloads the sorting models into public/models at build time (too big for git), each pinned to
 * an exact file and checked against its SHA-256. Cached in node_modules/.cache/models, so later
 * builds don't download again. The headshot models are small and live in git. */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HF = "https://huggingface.co";
export const MODELS = [
  {
    // Person detector for game photos (Apache-2.0). Lite0 (in git) misses small, far-away skaters.
    file: "efficientdet_lite2.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite",
    sha256: "b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896",
  },
  {
    // Jersey-number reader: PP-OCRv6 small text detection (Apache-2.0)
    file: "ppocrv6_small_det.onnx",
    url: `${HF}/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx`,
    sha256: "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
  },
  {
    // ... and recognition (Apache-2.0)
    file: "ppocrv6_small_rec.onnx",
    url: `${HF}/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx`,
    sha256: "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
  },
  {
    // "Pick your jersey": appearance embeddings, DINOv2 ViT-S/14, int8 (Apache-2.0)
    file: "dinov2_small_int8.onnx",
    url: `${HF}/onnx-community/dinov2-small/resolve/8b1f705a3a7f6f062f6bdd21986c1583d3ef105d/onnx/model_int8.onnx`,
    sha256: "dfce54a839b491f395c516350ebb4a78f947e9170a6beac0f2bc5638e0f09d61",
  },
];

const CACHE = "node_modules/.cache/models";
const OUT = "public/models";
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function download(m, dest) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(m.url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = createHash("sha256").update(buf).digest("hex");
      if (got !== m.sha256) throw new Error(`checksum mismatch (got ${got})`);
      writeFileSync(`${dest}.part`, buf);
      renameSync(`${dest}.part`, dest);
      return;
    } catch (e) {
      if (attempt >= 3) throw new Error(`Couldn't download ${m.file} from ${m.url}: ${e.message}`);
      console.warn(`  ${m.file}: ${e.message}, retrying…`);
    }
  }
}

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const m of MODELS) {
  const cached = join(CACHE, m.file);
  if (!existsSync(cached) || sha256(cached) !== m.sha256) {
    console.log(`Downloading ${m.file}…`);
    await download(m, cached);
  }
  const out = join(OUT, m.file);
  if (!existsSync(out) || sha256(out) !== m.sha256) copyFileSync(cached, out);
}
console.log(`Models ready in ${OUT}`);
