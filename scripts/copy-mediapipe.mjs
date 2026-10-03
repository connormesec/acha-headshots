import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/mediapipe/wasm", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", { recursive: true });
