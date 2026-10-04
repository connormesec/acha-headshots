# Plan: ACHA Headshots — standalone, in-browser rewrite

## Context
The headshot tool lives inside an existing app (`C:\Users\conno\projects\image_categorization`): a React frontend + Python backend (face finding, crop, compression). The owner wants it public and free to host on Hostinger Business ("Web App": static/JS only, no Python). So: a new standalone Vite + React + TS app where everything (decode, MediaPipe face/person detection, 2:3 crop, review/edit, 1000×1500 JPEG ≤ 2,000,000 B, ZIP download) runs in the visitor's browser. No backend, no uploads, no accounts.

The owner's full spec is reproduced verbatim in the **Appendix** below and is the source of truth. This top section only records decisions and corrections found while reading the old repo, plus execution order.

## Decisions and corrections (found in the old code)
1. **Project location (confirmed by owner):** everything is built directly in `C:\Users\conno\projects\acha_headshot_tool`. No `acha-headshots` folder is created. `git init` there. Step 0: copy the Appendix to `docs/SPEC.md` so the spec lives with the repo.
2. **Port check:** the spec's `crop.ts` matches `backend/app/processing/headshot_crop.py` line for line; `ops.ts` rules match `backend/app/services/headshot_service.py`. Two extras to carry over:
   - `_editable` also refuses edits while the batch is `PROCESSING`/`COMPRESSING` → `"Please wait until the photos have finished processing"`. Add to `editable(batch, item)`.
   - `rename` only drops a typed extension if it's an image extension (`_IMAGE_EXTS`); add `.jfif` to that set, and only clear/re-add `generic_name` + invalidate when the name actually changed.
   - `makeFiles` precondition (from `start_compress`): if no included READY item → `"Every photo is left out. Include at least one to make files."`
3. **`needs_look` field:** `Headshot.needs_look` is a server-computed field the components read. Compute it when exposing items from context (`{...item, needs_look: needsLook(item)}`), not stored.
4. **Limits:** `HeadshotUpload.tsx` fetches `api.headshotLimits()` and checks a 750 MB batch/ZIP total. Replace with constants (`MAX_PHOTOS`, `MAX_FILE_BYTES`); drop the total-size checks (no server). Copy "Up to 100 photos per batch".
5. **Items created up front:** at ingest, create every accepted photo as a `PENDING` item (with its unique output name) and store its original blob in `orig:<id>` before processing starts. This is what makes "Continue re-runs prepareItem for PENDING items" possible.
6. **Reload during COMPRESSING:** on restore, a `COMPRESSING` batch goes back to `READY` with `error_message = "Making files was interrupted. Try again."` (port of `fail_interrupted_batches`); `PROCESSING` resumes the PENDING items.
7. **Debug overlay:** `CropEditor` already draws used faces as `.editor__face` buttons. `?debug` adds: raw (unfiltered) face + person boxes from detection, and a line at the estimated head-top (`face.y − HEAD_ABOVE_FACE·face.h`). Raw boxes kept as a non-persisted internal field `debugBoxes` on the item.
8. **Plan agent skipped:** the spec is already an implementation-level design; no alternatives worth exploring.

## Execution order (each milestone ends with `npm run build` + `npm test` green, then a commit)
1. **Scaffold** — `package.json` (exact-pinned `@mediapipe/tasks-vision`), `vite.config.ts`, `tsconfig`, `index.html`, `scripts/copy-mediapipe.mjs`, download the two `.tflite` models into `public/models/`, `public/.htaccess`, `.gitignore` (`node_modules`, `dist`, `public/mediapipe`, `test-fixtures`). Copy `styles.css`, `components/ui.tsx`, `components/headshots/*`, `public/puck.svg` from the old frontend; render UploadScreen with fake data.
2. **Pure logic + unit tests** — `src/lib/constants.ts`, `crop.ts`, `names.ts`, `src/state/types.ts`, `ops.ts`; `tests/crop.test.ts` (15 ported tests from `backend/tests/test_headshots.py:43-170`), `tests/names.test.ts`, `tests/ops.test.ts` (rename rules from `test_rename_validation` at line 346, plus reset/rename/zip-invalidation tests).
3. **Ingest → Review** — `formats.ts`, `decode.ts`, `canvas.ts`, `detect.ts`, `process.ts`, `zipio.ts`, `ingest.ts` (copy `classify`, `filesFromDrop`, `isHidden` from `frontend/src/pages/HeadshotUpload.tsx`), `BatchContext.tsx`, `App.tsx`, `UploadScreen`, `ProcessingScreen`, `ReviewScreen` (split from `pages/HeadshotBatch.tsx`).
4. **Editing** — adapt `CropEditor.tsx` (`api.updateHeadshot` → `update` from context; drop `apiUrl`), `CropPreview.tsx`, NameField rename flow, include/exclude, approve, reset, tap-a-face.
5. **Make files + download** — `render.ts`, `ExportScreen`, `makeFiles()`/`download()`.
6. **Persistence** — `persist.ts` (idb-keyval, debounced 300 ms, blob keys), Continue / Start over / Clear, storage-failure note.
7. **Privacy + copy** — CSP meta, `@fontsource/*` imports, all copy changes from Appendix §9, remove `deletedIn`/`retentionText`, prune jobs/review/jersey/teams CSS.
8. **E2E + deploy docs** — `scripts/make-fixtures.mjs` (sharp, no real faces), `tests/e2e/headshots.spec.ts`, `playwright.config.ts` (webServer = `vite preview`), `README.md` with Hostinger steps.

Never read or copy anything from `image_categorization/backend/storage/`.

## Verification
- `npm test` — vitest unit suite (crop, names, ops).
- `npm run fixtures && npm run build && npm run e2e` — Playwright (Chromium; WebKit if installed) per Appendix §14: ZIP fixture → review, skipped/failed lists, rename, make files, download; Node + sharp asserts every entry is JPEG 1000×1500 ≤ 2,000,000 B, names match, no EXIF orientation/GPS, rotated fixture red at (500,20) and blue at (500,1480); every network request same-origin GET; reload → Continue restores items/crops/names.
- `npm run preview` in a browser: no console errors or CSP violations; `.wasm` served as `application/wasm`.
- Manual (owner): real headshots for §12 tuning via `?debug`, group photo, iPhone HEIC in Chrome + Safari, 30+ photos on iPhone, offline after first load, Hostinger subdomain.

---

# Appendix: owner's spec (verbatim)

ACHA Headshots: standalone, in-browser rewrite

## Context
The current headshot tool lives inside an existing app (C:\Users\conno\projects\image_categorization). It's a React frontend plus a Python backend that does the face finding, cropping and compression. The owner wants the headshot tool public and free to host. Their Hostinger Business plan can only host static or JavaScript web apps, so it can't run the Python backend.

Goal: a new, standalone project where everything runs in the visitor's browser:

- read photos or a ZIP
- find the face (MediaPipe)
- auto-crop to 2:3 head and shoulders
- let the user check and fix crops
- render each photo at exactly 1000×1500 JPEG, ≤ 2,000,000 bytes
- download a ZIP

No backend, no uploads, no accounts. Photos never leave the device, so one user can never see another's. It deploys as a static Vite site through Hostinger's "Web App" feature.

The old project's photo-sorting feature stays in the old project, run locally. It's out of scope here.

For the implementing agent:

- New project: **C:\Users\conno\projects\acha_headshot_tool** (the existing, empty workspace folder), with its own git repo. Wherever this spec says `acha-headshots/`, read `acha_headshot_tool/`.
- Reference (read-only): the old repo, C:\Users\conno\projects\image_categorization. Copy UI code from it as directed below. Never copy anything from backend/storage/. Those are real people's photos.

## 1. What carries over and what's new

| Old (server) | New (browser) |
|---|---|
| backend/app/processing/headshot_crop.py (framing and flags) | src/lib/crop.ts, a direct port (full code in §5) |
| backend/app/services/headshot_service.py (edit rules: crop, face, reset, approve, include, rename) | src/state/ops.ts, pure functions (§7) |
| zip_ingest.py (skip rules, sanitize_filename) | src/lib/ingest.ts + src/lib/names.ts (§6) |
| image_prep.py (decode, EXIF, transparency → white) | src/lib/decode.ts + src/lib/canvas.ts (§5) |
| OpenCV Haar faces + YOLO people | MediaPipe FaceDetector (BlazeFace) + ObjectDetector (EfficientDet-Lite0, "person") (§5) |
| headshot_processor.py render + ZIP | src/lib/render.ts + src/lib/zipio.ts (§5) |
| DB rows, 24h cleanup, cookies, limits | IndexedDB in the user's own browser (§8). Nothing else |
| React pages/components in frontend/src/ | Copied, with API calls replaced by local state (§9) |

Keep the old Headshot data shape, with its snake_case fields (frontend/src/types/api.ts lines ~268–346). That way the copied components (HeadshotCard, CropEditor, CropPreview, NameField, Stepper) work with minimal edits. image_url and thumbnail_url become blob: object URLs of the preview image.

## 2. Stack and dependencies
Vite 6, React 18, TypeScript 5 (same as the old frontend). No router: a single page whose screen comes from batch state. That avoids SPA-rewrite configuration on Hostinger.

| Package | Purpose |
|---|---|
| @mediapipe/tasks-vision (pin an exact version) | face + person detection (WASM, CPU) |
| @zip.js/zip.js | read uploaded ZIPs entry by entry; write the output ZIP (store, no compression) |
| heic-to | HEIC/HEIF decode when the browser can't (everything except Safari). Lazy-loaded |
| utif2 | TIFF decode. Lazy-loaded |
| idb-keyval | save work in IndexedDB so a refresh doesn't lose it |
| @fontsource/barlow, @fontsource/saira-condensed, @fontsource/graduate | self-hosted fonts, so the page makes no third-party requests |
| dev: vitest, @playwright/test, sharp (fixture generation and output checks only) | tests |

Browsers: current Chrome, Edge and Firefox, and Safari 16.4+ (macOS and iOS).

## 3. Project layout
```
acha-headshots/
  index.html                  # CSP meta (§10), title "ACHA Headshots"
  package.json
  vite.config.ts              # base: "./" so it works on a subdomain or in a subfolder
  public/
    puck.svg                  # copy from old frontend/public
    .htaccess                 # wasm/tflite MIME types (§11)
    models/blaze_face_short_range.tflite      # committed (~230 KB)
    models/efficientdet_lite0.tflite          # committed (~4.6 MB)
    mediapipe/wasm/           # generated by scripts/copy-mediapipe.mjs (gitignored)
  scripts/
    copy-mediapipe.mjs
    make-fixtures.mjs         # synthetic test images (no real people)
  src/
    main.tsx  App.tsx  styles.css
    lib/      crop.ts names.ts formats.ts decode.ts canvas.ts detect.ts render.ts zipio.ts ingest.ts process.ts
    state/    types.ts ops.ts BatchContext.tsx persist.ts
    screens/  UploadScreen.tsx ProcessingScreen.tsx ReviewScreen.tsx ExportScreen.tsx
    components/  (copied, §9) Stepper HeadshotCard CropPreview CropEditor NameField Modal UploadChecklist ui
  tests/      crop.test.ts names.test.ts ops.test.ts  e2e/headshots.spec.ts
  test-fixtures/              # generated, gitignored
```

vite.config.ts:
```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
```

package.json scripts:
```json
{
  "dev": "npm run copy-mediapipe && vite",
  "build": "npm run copy-mediapipe && tsc -b && vite build",
  "preview": "vite preview",
  "copy-mediapipe": "node scripts/copy-mediapipe.mjs",
  "fixtures": "node scripts/make-fixtures.mjs",
  "test": "vitest run",
  "e2e": "playwright test"
}
```

scripts/copy-mediapipe.mjs:
```js
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/mediapipe/wasm", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", { recursive: true });
```

Download the two models once and commit them:
- https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
- https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite

## 4. Constants (src/lib/constants.ts)
```ts
export const OUT_W = 1000, OUT_H = 1500;          // ACHA
export const MAX_OUTPUT_BYTES = 2_000_000;        // not 2 MiB, so either reading of "2 MB" passes
export const MAX_PHOTOS = 100;                    // per batch (device memory, not server cost)
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000;
export const PREVIEW_MAX_SIDE = 1600;             // preview shown in the editor AND used for detection
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;
```

## 5. Engine: code to write

### 5a. src/lib/crop.ts: exact port of headshot_crop.py
Crops are fractions (0–1) of the image, so one box applies to the preview and to the full-size original.

```ts
export type Flag = "not_headshot" | "no_face" | "multiple_people" | "small_face" | "low_resolution" | "upscaled" | "generic_name";
export interface Box { x: number; y: number; width: number; height: number }   // pixels
export interface Crop { x: number; y: number; w: number; h: number }           // fractions
export interface Assessment { crop: Crop; source: "face" | "person" | "center"; flags: Flag[]; faces: Crop[] }

export const ASPECT = 2 / 3;
// Framing. Tune against real headshots (§12). HEAD_ABOVE_FACE was tuned for Haar boxes, which
// start near the eyebrows; BlazeFace boxes start higher, so expect ~0.2–0.3.
export const FACE_FRACTION = 0.32;      // face box height / crop height
export const HEAD_ABOVE_FACE = 0.35;    // top of head is this many face-heights above the box
export const HEAD_TOP_MARGIN = 0.10;    // space above the head, fraction of crop height
export const PERSON_FACE_WIDTH = 0.38;
export const PERSON_FACE_MAX_HEIGHT = 0.20;
export const MIN_FACE_FRACTION = 0.04;
export const SMALL_FACE_FRACTION = 0.08;
export const SECOND_FACE_RATIO = 0.5;
export const LOW_RES_PX = 600;
export const UPSCALE_PX = 1000;
export const SOFT_FLAGS = new Set<Flag>(["generic_name", "upscaled"]);   // never "needs a look"

const GENERIC_NAME = /^(img|dsc|dscn|dscf|dcim|photo|image|pxl|screenshot|untitled|picture|pic|mvimg|file)[\W_]*\d*/i;
export const isGenericName = (filename: string) => GENERIC_NAME.test(filename);

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const area = (b: Box) => b.width * b.height;

/** Build a 2:3 box in pixels, then move/shrink it to fit inside the image. */
function fit(cx: number, top: number, cropH: number, imgW: number, imgH: number, anchorTop?: number): Crop {
  let cropW = cropH * ASPECT;
  const scale = Math.min(1, imgW / cropW, imgH / cropH);
  if (scale < 1) {
    cropW *= scale;
    cropH *= scale;
    if (anchorTop !== undefined) top = anchorTop - HEAD_TOP_MARGIN * cropH;
  }
  const left = Math.min(Math.max(0, cx - cropW / 2), imgW - cropW);
  top = Math.min(Math.max(0, top), imgH - cropH);
  return { x: left / imgW, y: top / imgH, w: cropW / imgW, h: cropH / imgH };
}

export function frameFace(face: Box, imgW: number, imgH: number): Crop {
  const cropH = face.height / FACE_FRACTION;
  const headTop = face.y - HEAD_ABOVE_FACE * face.height;
  return fit(face.x + face.width / 2, headTop - HEAD_TOP_MARGIN * cropH, cropH, imgW, imgH, headTop);
}

export function framePerson(p: Box, imgW: number, imgH: number): Crop {
  const size = Math.max(1, Math.min(p.width * PERSON_FACE_WIDTH, p.height * PERSON_FACE_MAX_HEIGHT));
  return frameFace(
    { x: Math.round(p.x + p.width / 2 - size / 2), y: Math.round(p.y + HEAD_ABOVE_FACE * size),
      width: Math.round(size), height: Math.round(size) },
    imgW, imgH,
  );
}

/** Largest 2:3 box, centred horizontally, aligned to the top. */
export const frameCenter = (imgW: number, imgH: number) => fit(imgW / 2, 0, imgH, imgW, imgH);

/** User edits: force 2:3 (height follows width) and keep inside the image. */
export function normalizeCrop(x: number, y: number, w: number, imgW: number, imgH: number): Crop {
  w = clamp(w, 0.02, 1);
  let h = (w * imgW) / ASPECT / imgH;
  if (h > 1) { const cx = x + w / 2; w = w / h; h = 1; x = cx - w / 2; }
  return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
}

/** Pixel rectangle with an exact 2:3 ratio. */
export function cropPixels(c: Crop, imgW: number, imgH: number) {
  let width = Math.max(2, Math.round(c.w * imgW));
  let height = Math.round(width / ASPECT);
  if (height > imgH) { height = imgH; width = Math.max(2, Math.round(height * ASPECT)); }
  const left = clamp(Math.round(c.x * imgW), 0, Math.max(0, imgW - width));
  const top = clamp(Math.round(c.y * imgH), 0, Math.max(0, imgH - height));
  return { left, top, width, height };
}

const inside = (f: Box, p: Box) => {
  const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
  return p.x <= cx && cx <= p.x + p.width && p.y <= cy && cy <= p.y + p.height;
};
const twoSubjects = (sorted: Box[]) => sorted.length > 1 && area(sorted[1]) >= SECOND_FACE_RATIO * area(sorted[0]);

/** Drop tiny faces and faces outside every person (false positives). Largest first. */
export function usableFaces(faces: Box[], persons: Box[], imgW: number, imgH: number): Box[] {
  const minSide = MIN_FACE_FRACTION * Math.min(imgW, imgH);
  let kept = faces.filter((f) => f.height >= minSide);
  if (persons.length) kept = kept.filter((f) => persons.some((p) => inside(f, p)));
  return kept.sort((a, b) => area(b) - area(a));
}

/** Pick the auto crop and flag anything a human should look at. Never throws. */
export function assess(faces: Box[], persons: Box[], imgW: number, imgH: number): Assessment {
  persons = [...persons].sort((a, b) => area(b) - area(a));
  const good = usableFaces(faces, persons, imgW, imgH);
  const asFrac = good.map((f) => ({ x: f.x / imgW, y: f.y / imgH, w: f.width / imgW, h: f.height / imgH }));
  const flags: Flag[] = [];
  if (good.length) {
    if (twoSubjects(good) || twoSubjects(persons)) flags.push("multiple_people");
    if (good[0].height < SMALL_FACE_FRACTION * imgH) flags.push("small_face");
    return { crop: frameFace(good[0], imgW, imgH), source: "face", flags, faces: asFrac };
  }
  if (persons.length) {
    flags.push("no_face");
    if (twoSubjects(persons)) flags.push("multiple_people");
    return { crop: framePerson(persons[0], imgW, imgH), source: "person", flags, faces: asFrac };
  }
  flags.push("not_headshot");
  return { crop: frameCenter(imgW, imgH), source: "center", flags, faces: asFrac };
}

export function resolutionFlags(crop: Crop, originalW: number): Flag[] {
  const px = crop.w * originalW;
  return px < LOW_RES_PX ? ["low_resolution"] : px < UPSCALE_PX ? ["upscaled"] : [];
}
```

### 5b. src/lib/formats.ts + src/lib/decode.ts: any photo to an upright ImageBitmap
```ts
export type Kind = "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heic" | "avif" | "unknown";

/** Identify by content, not extension. */
export async function sniff(blob: Blob): Promise<Kind> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const s = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (s(1, 4) === "PNG") return "png";
  if (s(0, 4) === "GIF8") return "gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "webp";
  if (s(0, 2) === "BM") return "bmp";
  if (s(0, 4) === "II*\0" || s(0, 4) === "MM\0*") return "tiff";
  if (s(4, 8) === "ftyp") {
    const brand = s(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
  }
  return "unknown";
}
```
```ts
export class PhotoError extends Error {}   // message is shown to the user as-is

const native = (blob: Blob) => createImageBitmap(blob, { imageOrientation: "from-image" }); // applies EXIF rotation

export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  const kind = await sniff(blob);
  if (kind === "unknown") throw new PhotoError("This file couldn't be opened. It may be damaged, or not really a photo.");
  try {
    if (kind === "tiff") return await decodeTiff(blob);
    if (kind === "heic") {
      try { return await native(blob); } catch { /* only Safari decodes HEIC natively */ }
      const { heicTo } = await import("heic-to");
      return await native(await heicTo({ blob, type: "image/jpeg", quality: 0.95 }));
    }
    return await native(blob);
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    throw new PhotoError("This file couldn't be opened. It may be damaged, or not really a photo.");
  }
}

async function decodeTiff(blob: Blob): Promise<ImageBitmap> {
  const UTIF = await import("utif2");
  const buf = await blob.arrayBuffer();
  const [page] = UTIF.decode(buf);
  UTIF.decodeImage(buf, page);
  const rgba = UTIF.toRGBA8(page);
  return createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer), page.width, page.height));
}
```
After decoding, check `bmp.width * bmp.height > MAX_PIXELS`. If it's too big, throw `PhotoError("This photo is too large to process. Resize it below 100 megapixels and add it again.")`.

### 5c. src/lib/canvas.ts: high-quality scaling, transparency → white
```ts
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";            // transparent PNG/GIF areas become white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  return c;
}

/** Draw a source region at a new size. Halves in steps first so big reductions stay sharp. */
export function drawRegion(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
                           dw: number, dh: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  while (sw > dw * 2) {
    const w = Math.round(sw / 2), h = Math.round(sh / 2);
    const step = makeCanvas(w, h);
    step.getContext("2d")!.drawImage(cur, sx, sy, sw, sh, 0, 0, w, h);
    cur = step; sx = 0; sy = 0; sw = w; sh = h;
  }
  const out = makeCanvas(dw, dh);
  out.getContext("2d")!.drawImage(cur, sx, sy, sw, sh, 0, 0, dw, dh);
  return out;
}

export function drawScaled(src: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  return drawRegion(src, 0, 0, src.width, src.height, Math.round(src.width * s), Math.round(src.height * s));
}

export const toJpeg = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("JPEG encode failed"))), "image/jpeg", quality));
```

### 5d. src/lib/detect.ts: MediaPipe, loaded once and served from our own site
```ts
import { FaceDetector, FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { asset } from "./constants";
import type { Box } from "./crop";

let loading: Promise<{ face: FaceDetector; person: ObjectDetector }> | undefined;

export function loadDetectors() {
  return (loading ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(asset("mediapipe/wasm"));
    const [face, person] = await Promise.all([
      FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: asset("models/blaze_face_short_range.tflite"), delegate: "CPU" },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.5,
      }),
      ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: asset("models/efficientdet_lite0.tflite"), delegate: "CPU" },
        runningMode: "IMAGE",
        scoreThreshold: 0.4,
        categoryAllowlist: ["person"],
        maxResults: 6,
      }),
    ]);
    return { face, person };
  })());
}

const toBox = (b: { originX: number; originY: number; width: number; height: number }): Box =>
  ({ x: b.originX, y: b.originY, width: b.width, height: b.height });

/** Boxes are in the canvas's pixel space. */
export async function detect(canvas: HTMLCanvasElement): Promise<{ faces: Box[]; persons: Box[] }> {
  const { face, person } = await loadDetectors();
  return {
    faces: face.detect(canvas).detections.flatMap((d) => (d.boundingBox ? [toBox(d.boundingBox)] : [])),
    persons: person.detect(canvas).detections.flatMap((d) => (d.boundingBox ? [toBox(d.boundingBox)] : [])),
  };
}
```
- Call `loadDetectors()` when the upload screen mounts, so models are warm by the time the user submits.
- If it rejects, show "Couldn't load the face finder. Check your connection and reload."

### 5e. src/lib/process.ts: prepare one photo (port of HeadshotProcessor._crop_one)
```ts
export async function prepareItem(original: Blob, outputName: string): Promise<Partial<Headshot>> {
  const bmp = await decodeImage(original);
  try {
    const originalW = bmp.width, originalH = bmp.height;
    if (originalW * originalH > MAX_PIXELS) throw new PhotoError("This photo is too large to process. Resize it below 100 megapixels and add it again.");
    const preview = drawScaled(bmp, PREVIEW_MAX_SIDE);
    const { faces, persons } = await detect(preview);
    const a = assess(faces, persons, preview.width, preview.height);
    const res = resolutionFlags(a.crop, originalW);
    const flags: Flag[] = [...a.flags, ...res, ...(isGenericName(outputName) ? (["generic_name"] as Flag[]) : [])];
    const previewBlob = await toJpeg(preview, 0.9);
    const url = URL.createObjectURL(previewBlob);
    return {
      status: "READY", image_url: url, thumbnail_url: url,
      width: preview.width, height: preview.height, original_width: originalW, original_height: originalH,
      crop: a.crop, crop_source: a.source, flags, faces: a.faces, low_resolution: res.length > 0,
      // internal (not in the old type): autoCrop, autoFlags, previewBlob
    };
  } finally {
    bmp.close();   // never keep full-size bitmaps around: phones run out of memory
  }
}
```
- Process photos one at a time in a loop.
- Dispatch progress after each one, and `await new Promise(requestAnimationFrame)` between photos so the UI stays responsive.
- A thrown PhotoError marks that item FAILED, not included, with `error_message = e.message`. Any other error becomes "Something went wrong with this photo". The batch always carries on.

### 5f. src/lib/render.ts: final 1000×1500 JPEG ≤ 2 MB (port of render_headshot and encode_under)
```ts
export async function renderHeadshot(original: Blob, crop: Crop): Promise<Blob> {
  const bmp = await decodeImage(original);
  try {
    const { left, top, width, height } = cropPixels(crop, bmp.width, bmp.height);
    return await encodeUnder(drawRegion(bmp, left, top, width, height, OUT_W, OUT_H), MAX_OUTPUT_BYTES);
  } finally {
    bmp.close();
  }
}

/** Highest JPEG quality (stepping down by 0.04) that fits. Canvas writes no EXIF/GPS metadata. */
export async function encodeUnder(c: HTMLCanvasElement, maxBytes: number, start = 0.92, floor = 0.5): Promise<Blob> {
  for (let q = start; ; q = Math.max(floor, q - 0.04)) {
    const blob = await toJpeg(c, q);
    if (blob.size <= maxBytes) return blob;
    if (q <= floor) throw new PhotoError("This photo couldn't be made small enough. Try a different photo.");
  }
}
```

### 5g. src/lib/zipio.ts: read and write ZIPs
```ts
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";

export async function readZip(file: Blob) {
  const reader = new ZipReader(new BlobReader(file));
  try { return await reader.getEntries(); } catch { throw new Error("That file isn't a valid ZIP. Try re-creating it, or add the photos directly."); }
  // keep `reader` open until all accepted entries are extracted, then `await reader.close()`
}
// extract: const blob = await entry.getData!(new BlobWriter());

export async function writeZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { level: 0 });   // JPEGs don't compress
  for (const f of files) await w.add(f.name, new BlobReader(f.blob));
  return w.close();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
```
The download filename is `${safeBatchName || "headshots"} - ACHA headshots.zip`. For safeBatchName, replace any character that isn't a letter, digit, space, - or _ with _ (same as headshots.py download).

## 6. Ingest rules (src/lib/ingest.ts, src/lib/names.ts)
Port from backend/app/processing/zip_ingest.py and frontend/src/pages/HeadshotUpload.tsx (classify, filesFromDrop, isHidden; copy those functions as they are).

Accepted extensions: .jpg .jpeg .jfif .png .heic .heif .webp .gif .avif .bmp .tif .tiff. The extension is used only for filtering; decoding sniffs the actual content.

Input: one .zip or loose files and folders, never both. These messages already exist in classify.

Skip reasons. Silent ones are not listed to the user; the rest show up under "N skipped":
- silent: directory, a path part starting with ., a __MACOSX folder
- "not a photo we can use": wrong extension
- "password-protected inside the ZIP": entry.encrypted
- "over 60 MB. Export a smaller copy.": bigger than MAX_FILE_BYTES
- "looks damaged": in a ZIP, uncompressed/compressed > 200

More than MAX_PHOTOS candidates: reject before any processing with "That's N photos. The limit is 100 per batch, so split them into smaller batches."

Order: sort candidates by lowercase path.

Output names: `uniqueOutputName(stem(sanitizeFilename(basename)), taken)`, giving smith_27.jpg, smith_27-1.jpg, … (case-insensitive uniqueness).

```ts
const SAFE = /[^A-Za-z0-9._\- ]+/g;
const trimChars = (s: string, chars: string) => s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, "g"), "");

/** Port of zip_ingest.sanitize_filename. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  let [stem, ext] = dot >= 0 ? [base.slice(0, dot), base.slice(dot + 1)] : [base, ""];
  stem = trimChars(stem.replace(SAFE, "_"), " .") || "photo";
  ext = ext.replace(SAFE, "").toLowerCase();
  return ext ? `${stem.slice(0, 150)}.${ext}` : stem.slice(0, 150);
}

export const stemOf = (name: string) => { const d = name.lastIndexOf("."); return (d > 0 ? name.slice(0, d) : name) || "headshot"; };

export function uniqueOutputName(stem: string, taken: Set<string>): string {
  let candidate = `${stem}.jpg`;
  for (let n = 1; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}.jpg`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
```

## 7. State (src/state/)
**types.ts**
- Re-use the old Headshot, Crop, HeadshotFlag and HeadshotPatch types, copied from frontend/src/types/api.ts.
- Make `Item = Headshot & { autoCrop: Crop | null; autoFlags: HeadshotFlag[]; rendered: { blob: Blob; bytes: number } | null }`. Original blobs live in a side map (`Map<id, Blob>`), not in React state.
- Batch:
```ts
interface Batch {
  id: string; name: string;
  status: "PROCESSING" | "READY" | "COMPRESSING" | "COMPRESSED" | "FAILED";
  items: Item[]; skipped: { name: string; reason: string }[];
  processed: number; compressed: number; error_message: string | null;
  zip: Blob | null;            // set when COMPRESSED; cleared by any edit (see invalidate)
  created_at: string;
}
```

**ops.ts** holds pure functions, each `(batch, id, ...) => Batch`. They port headshot_service.py exactly:
- `editable(item)`: throws "This photo couldn't be opened, so it can't be edited" unless status === "READY".
- `invalidate(batch)`: zip = null; if COMPRESSED, go back to READY.
- `keepSoft(flags)`: keeps only "generic_name".
- `setManualCrop(x, y, w)`: crop = normalizeCrop(x, y, w, item.width, item.height); crop_source = "manual"; res = resolutionFlags(crop, original_width), then low_resolution = res.length > 0 and flags = [...keepSoft(flags), ...res]; rendered = null, then invalidate.
- `frameOnFace(index)`: an out-of-range index throws "That face isn't in this photo"; convert the face's fractions to preview pixels, run frameFace, then apply the same updates as setManualCrop.
- `resetCrop()`: crop = autoCrop, approved = false; crop_source: not_headshot → center, no_face → person, otherwise face; flags = [...keepSoft(flags), ...autoFlags without generic_name]; low_resolution is true if autoFlags includes low_resolution or upscaled; rendered = null, then invalidate.
- `approve()`: sets approved = true.
- `setIncluded(b)`: if it changed, invalidate. No re-render.
- `rename(requested)`: port of headshot_service.rename. Take the basename and drop any image extension. Empty after trimming `._` → "Type a name for this photo". The new name is sanitizeFilename(stem) cut to 150 characters, with trailing `.` trimmed, plus .jpg. A case-insensitive clash → "Another photo is already named X". Update generic_name, then invalidate. Renaming doesn't clear rendered.
- `applyPatch(batch, id, patch: HeadshotPatch)` dispatches on the patch's single key. This keeps the components' old `api.updateHeadshot(id, patch)` call shape.
- Selectors (were server-computed):
  - `needsLook(i) = i.status === "READY" && i.included && !i.approved && i.flags.some(f => !SOFT_FLAGS.has(f))`
  - `summary(batch) = { needs_look, to_compress, excluded, generic_names }`

**BatchContext.tsx**
- Holds useReducer and the originals Map.
- Exposes `start(files)`, `update(id, patch) => Headshot` (throws Error with the message for NameField and CropEditor), `makeFiles()`, `download()`, `clear()`.

makeFiles() (port of _compress):
1. Set status COMPRESSING.
2. For each included READY item without rendered, call renderHeadshot and store {blob, bytes}. Increment compressed after each item.
3. Call writeZip with output_name → rendered.blob, then set status COMPRESSED.
4. If a render fails: go back to READY and set error_message.

## 8. Saving work in the browser (src/state/persist.ts, using idb-keyval)
Storage keys:
- "batch": the batch JSON, without blobs or object URLs, saved debounced (300 ms) after every change
- "orig:<id>", "prev:<id>", "out:<id>": Blobs, written once when created

On load: if "batch" exists, the upload screen shows "Continue your batch "<name>" (N photos)" with Continue and Start over buttons.
- Continue recreates object URLs from the prev: blobs and re-runs prepareItem for any item still PENDING.
- Start over (and Clear photos from this browser on the export screen) runs clear(), revokes object URLs, and resets state.
- If writes fail (quota, private mode): catch the error, show one note ("Your work won't survive a page refresh in this browser"), and carry on. Never block the flow on storage.

## 9. UI: copy and adapt from the old frontend
Copy frontend/src/styles.css whole, along with components/ui.tsx (ErrorNote, Loading) and components/headshots/*. Prune unused selectors at the end: anything for jobs, review, jersey or teams.

| Old file | Change |
|---|---|
| components/headshots/CropPreview.tsx | drop apiUrl(...); use src directly (blob URL) |
| components/headshots/CropEditor.tsx | replace api.updateHeadshot(item.id, patch) with update(item.id, patch) from context (same return shape); drop apiUrl. Add a ?debug overlay that draws item.faces boxes (for tuning, §12) |
| components/headshots/HeadshotCard.tsx, NameField.tsx, Modal.tsx, UploadChecklist.tsx | unchanged |
| components/headshots/Stepper.tsx | keep Stepper; delete deletedIn and retentionText |
| pages/Headshots.tsx (hero) + pages/HeadshotUpload.tsx | merge into UploadScreen. There's no batch list. Replace the upload XHR with start(files); the progress meter now shows "Reading photos…" |
| pages/HeadshotBatch.tsx | split into ProcessingScreen, ReviewScreen and ExportScreen. Keep the layout and copy; replace api.* calls, polling and reload() with context state. The download button calls download() instead of an `<a href>` to the server |
| components/Layout.tsx | simple masthead: brand "ACHA Headshots", no nav |

App.tsx chooses the screen from state:
- no batch → UploadScreen
- PROCESSING → ProcessingScreen
- READY, FAILED, or a "back to crops" flag → ReviewScreen
- COMPRESSING or COMPRESSED → ExportScreen

Copy changes. Remove every server or deletion promise:
- "Photos are deleted automatically a day after upload" (hero, upload page, review, export) → "Your photos never leave your device. Everything happens in your browser."
- "You can leave this page and come back" → "Keep this tab open. Your progress is saved in this browser."
- Remove the "This batch has been deleted" screen and "Download it soon…".
- Export screen: add Start a new batch and Clear photos from this browser.
- First load of the face finder: "Getting the face finder ready…"

index.html:
- remove the Google Fonts links; import @fontsource/* in main.tsx instead
- title "ACHA Headshots"
- add the CSP from §10

## 10. Privacy hardening
Add to index.html. This makes "never leaves your device" enforceable by the browser:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
  connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline';
  font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
```
- No analytics or third-party scripts. Nothing ever uses fetch, XMLHttpRequest, sendBeacon or `<form>` to send photo data anywhere.
- If MediaPipe or zip.js is blocked by this CSP (watch the console in dev and prod builds), loosen only the specific directive. Say why in a comment.

## 11. Deploy to Hostinger (Business plan "Web App")
public/.htaccess (Hostinger serves static files with LiteSpeed/Apache):
```
AddType application/wasm .wasm
AddType application/octet-stream .tflite
<FilesMatch "\.(wasm|tflite)$">
  Header set Cache-Control "public, max-age=604800"
</FilesMatch>
```
Steps. Write these into the new README.md; hPanel labels may differ slightly.
1. Push the project to a GitHub repo.
2. In hPanel, add a Web App, connect GitHub, and choose the repo. Use framework Vite, build command `npm run build`, output directory `dist`, Node 20+.
3. Attach a subdomain, e.g. headshots.yourdomain.com. HTTPS is provided by Hostinger.
4. Every push to the main branch redeploys.
5. Fallback: run `npm run build` locally and upload the contents of dist/ with File Manager to the subdomain's folder. `base: "./"` makes this work in any folder.

## 12. Tuning the crop for BlazeFace
Haar face boxes (old) start near the eyebrows; BlazeFace boxes start higher. With the ?debug overlay and ~10 real headshots (the owner's own, never committed):
- Adjust HEAD_ABOVE_FACE so the top of the hair sits about 10% below the crop's top edge (HEAD_TOP_MARGIN). Expect ~0.2–0.3.
- Adjust FACE_FRACTION so the bottom edge lands around mid-chest.
- Record the final values in a comment above the constants.

## 13. Milestones (each ends green: npm run build + npm test)
1. Scaffold. Vite app, dependencies, scripts, committed models, .htaccess. Copied styles and components rendering the upload screen with fake data.
2. Pure logic + unit tests. crop.ts, names.ts, ops.ts.
   - Port the framing tests from backend/tests/test_headshots.py (lines ~43–170) to vitest, test for test: test_face_framing_is_2x3_centred_with_space_above_head, test_face_near_edge_is_shifted_inside, test_face_too_big_for_image_shrinks_but_keeps_ratio, test_center_crop_is_largest_top_aligned_box, test_normalize_crop_fixes_ratio_and_bounds, test_crop_pixels_are_exact_ratio_and_in_bounds, test_clear_headshot_has_no_flags, test_no_face_no_person_is_not_a_headshot, test_person_without_face_uses_person_framing, test_two_similar_faces_flag_group_photo_and_use_largest, test_small_face_is_flagged, test_face_outside_every_person_is_a_false_positive, test_tiny_faces_are_ignored, test_resolution_flags, test_generic_names
   - Port the rename rules from test_rename_validation: " " → error; "B_11" clashes with b_11.jpg; "../evil" → evil.jpg; "Connor Mesec12.JPG" → Connor Mesec12.jpg
   - Add ops tests: reset restores the auto crop and flags; rename keeps rendered; a crop change clears it; any edit clears zip
3. Ingest + decode + detect + process. Drop photos or a ZIP to reach the Review screen with auto crops and flags. Skipped and failed files are listed.
4. Editing. Crop editor (drag, zoom, keyboard), tap a face to re-frame, reset, looks good, leave out / put back, rename with Enter-to-next.
5. Make files + download. Export screen; the ZIP contains only included photos with their output names.
6. Persistence. Refresh mid-review: Continue restores everything. Start over and Clear wipe IndexedDB.
7. Privacy + copy. CSP, self-hosted fonts, all copy changes from §9, prune unused CSS.
8. E2E + deploy. Playwright suite (§14), README, Hostinger deploy.

## 14. Verification
Fixtures (`npm run fixtures`, which uses sharp and contains no real faces):
- large portrait JPEG
- small JPEG (→ low_resolution)
- JPEG stored rotated with EXIF orientation 6: upright, top half red and bottom half blue
- PNG with transparency
- WebP, GIF, TIFF
- noisy 4000×6000 JPEG (forces the quality loop)
- notes.txt, .DS_Store, __MACOSX/._a.jpg
- a corrupt broken.jpg
- fixtures.zip containing all of the above

Playwright (Chromium, plus WebKit if available):
- Load the page and set the files input to fixtures.zip. Expect the Review screen.
- broken.jpg is listed as couldn't be opened
- notes.txt shows as skipped; the hidden files are silent
- Rename one photo. Click "Make ACHA files", confirm "Make files anyway", then catch the download.
- Open the ZIP in Node. For every entry, sharp(...).metadata() must report JPEG, 1000×1500, and size ≤ 2,000,000.
- Names match the review screen.
- There's no EXIF orientation or GPS.
- In the rotated fixture's output, the pixel at (500, 20) is red and at (500, 1480) is blue.
- Network assertion: record every request during the test. All must be same-origin GETs, never a POST or PUT, never another host.
- Reload mid-review and choose Continue. The same items, crops and names come back.

Manual checks:
- Real headshots (the owner's own): faces are found and framing looks right after §12 tuning.
- Group photo: flagged "more than one person", and tapping the other face re-frames.
- iPhone HEIC: works in Chrome (heic-to) and in Safari (native).
- Phone: 30+ large photos on an iPhone without the tab crashing.
- Offline: after first load, turn on airplane mode. Processing and download still work.
- Production build: `npm run build && npm run preview`, then the same checks with no console errors, including CSP violations.
- After deploying: repeat on the Hostinger subdomain. In DevTools → Network, .wasm is served as application/wasm.
