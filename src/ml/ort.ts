/** ONNX Runtime (WebAssembly), served from our own site (public/ort), models from public/models.
 * Uses several threads when the page is
 * cross-origin isolated (the Node server sends the headers; a plain static host gets one thread). */

import * as ort from "onnxruntime-web/wasm";
import { asset } from "../lib/constants";
import type { RunModel, Tensor } from "./ocr/reader";

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  // Absolute: ORT resolves a relative path against its own script (assets/), not the page.
  ort.env.wasm.wasmPaths = new URL(asset("ort/"), location.href).href;
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  // No proxy worker: it can't start from a bundled chunk. Inference runs on the page; the pipeline
  // awaits between steps, so the page stays responsive.
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
}

const sessions = new Map<string, Promise<ort.InferenceSession>>();

/** One session per model file, loaded once; a failed load is retried on the next call. */
export function session(file: string): Promise<ort.InferenceSession> {
  configure();
  let s = sessions.get(file);
  if (!s) {
    s = ort.InferenceSession.create(asset(`models/${file}`), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    s.catch(() => sessions.delete(file));
    sessions.set(file, s);
  }
  return s;
}

export async function runOnce(file: string, input: Tensor): Promise<Tensor> {
  const s = await session(file);
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input.data, input.dims as number[]) });
  const t = out[s.outputNames[0]];
  const result = { data: t.data as Float32Array, dims: t.dims };
  return result;
}

/** RunModel for the number reader. */
export const OCR_MODELS = { det: "ppocrv6_small_det.onnx", rec: "ppocrv6_small_rec.onnx" } as const;
export const runOcr: RunModel = (model, input) => runOnce(OCR_MODELS[model], input);
