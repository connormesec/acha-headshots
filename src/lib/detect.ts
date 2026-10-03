import { FaceDetector, FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { asset } from "./constants";
import type { Box } from "./crop";

let loading: Promise<{ face: FaceDetector; person: ObjectDetector }> | undefined;

/** Loads the WASM runtime and both models once, from our own site (public/mediapipe, public/models). */
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
  })().catch((e) => {
    loading = undefined; // let a later call try again
    throw e;
  }));
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
