import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

// Serve onnxruntime-web's WebAssembly from our own site (the CSP allows nothing else). Only the
// plain SIMD build is used: no WebGPU (JSEP) or JSPI variants.
rmSync("public/ort", { recursive: true, force: true });
mkdirSync("public/ort", { recursive: true });
for (const f of readdirSync("node_modules/onnxruntime-web/dist")) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f)) cpSync(`node_modules/onnxruntime-web/dist/${f}`, `public/ort/${f}`);
}
