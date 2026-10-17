import { FaceDetector, FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { asset } from "../lib/constants";
import type { Box } from "../lib/geometry";

type Vision = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Retry on the next call if loading failed (a flaky connection shouldn't stick). */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => (loading ??= load().catch((e) => {
    loading = undefined;
    throw e;
  }));
}

/** The WASM runtime, from our own site (public/mediapipe). */
const vision = once<Vision>(() => FilesetResolver.forVisionTasks(asset("mediapipe/wasm")));

const personDetector = (model: string, maxResults: number) => async () =>
  ObjectDetector.createFromOptions(await vision(), {
    baseOptions: { modelAssetPath: asset(`models/${model}`), delegate: "CPU" },
    runningMode: "IMAGE",
    scoreThreshold: 0.4,
    categoryAllowlist: ["person"],
    maxResults,
  });

/** Headshots: faces, and people (to find hair and to spot group photos). */
export const loadDetectors = once(async () => {
  const [face, person] = await Promise.all([
    FaceDetector.createFromOptions(await vision(), {
      baseOptions: { modelAssetPath: asset("models/blaze_face_short_range.tflite"), delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    }),
    personDetector("efficientdet_lite0.tflite", 6)(),
  ]);
  return { face, person };
});

/** Photo sorting: every player in a game photo. Port of detection/yolo.py's settings. */
export const PERSON_MODEL = "efficientdet_lite2.tflite";
export const MAX_PEOPLE = 12;
export const MIN_BOX_AREA = 0.01; // of the photo
export const loadPersonDetector = once(personDetector(PERSON_MODEL, MAX_PEOPLE));

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

export interface PersonDetection { box: Box; confidence: number }

/** People in a game photo, clipped to the image, tiny boxes dropped, most confident first. */
export async function detectPeople(canvas: HTMLCanvasElement): Promise<PersonDetection[]> {
  const detector = await loadPersonDetector();
  const w = canvas.width, h = canvas.height;
  const out: PersonDetection[] = [];
  for (const d of detector.detect(canvas).detections) {
    if (!d.boundingBox) continue;
    const b = toBox(d.boundingBox);
    const x0 = Math.max(0, Math.round(b.x)), y0 = Math.max(0, Math.round(b.y));
    const x1 = Math.min(w, Math.round(b.x + b.width)), y1 = Math.min(h, Math.round(b.y + b.height));
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) < MIN_BOX_AREA * w * h) continue;
    out.push({ box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, confidence: Math.round((d.categories[0]?.score ?? 0) * 1e4) / 1e4 });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_PEOPLE);
}
