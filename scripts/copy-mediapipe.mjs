import { cpSync, mkdirSync, rmSync } from "node:fs";

// Serve MediaPipe's WASM runtime from our own site. The "_module" build is only used when
// FilesetResolver.forVisionTasks(path, true) asks for it, which we don't, so it's left out (11 MB).
rmSync("public/mediapipe/wasm", { recursive: true, force: true });
mkdirSync("public/mediapipe/wasm", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", {
  recursive: true,
  filter: (src) => !src.includes("_module_"),
});
