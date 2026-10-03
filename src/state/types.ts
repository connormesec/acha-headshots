/** Data shapes. Headshot, Crop, HeadshotFlag and HeadshotPatch keep the old server's snake_case
 * shape (Puck Press frontend/src/types/api.ts) so the copied components work unchanged. */

import type { Box } from "../lib/crop";

/** Fractions (0..1) of the image. Always a 2:3 portrait box. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HeadshotFlag =
  | "not_headshot"
  | "no_face"
  | "multiple_people"
  | "small_face"
  | "low_resolution"
  | "upscaled"
  | "generic_name";

export interface Headshot {
  id: string;
  original_filename: string;
  output_name: string;
  status: "PENDING" | "READY" | "FAILED";
  error_message: string | null;
  image_url: string | null;      // blob: URL of the preview
  thumbnail_url: string | null;  // same as image_url
  width: number | null;          // preview size
  height: number | null;
  original_width: number | null;
  original_height: number | null;
  crop: Crop | null;
  crop_source: "face" | "person" | "center" | "manual" | null;
  flags: HeadshotFlag[];
  faces: Crop[];
  low_resolution: boolean;
  included: boolean;
  approved: boolean;
  needs_look: boolean;
  output_bytes: number | null;
}

export type HeadshotPatch =
  | { crop: { x: number; y: number; w: number } }
  | { reset: true }
  | { face_index: number }
  | { approved: true }
  | { included: boolean }
  | { output_name: string };

/** Raw detections in preview pixels, for the ?debug overlay. */
export interface Detections { faces: Box[]; persons: Box[] }

export type Item = Headshot & {
  autoCrop: Crop | null;
  autoFlags: HeadshotFlag[];
  rendered: { blob: Blob; bytes: number } | null;
  debug?: Detections;
};

export type BatchStatus = "PROCESSING" | "READY" | "COMPRESSING" | "COMPRESSED" | "FAILED";

export interface Skipped { name: string; reason: string }

export interface Batch {
  id: string;
  name: string;
  status: BatchStatus;
  items: Item[];
  skipped: Skipped[];
  processed: number;
  compressed: number;
  error_message: string | null;
  zip: Blob | null;            // set when COMPRESSED; cleared by any edit (see invalidate)
  created_at: string;
}
