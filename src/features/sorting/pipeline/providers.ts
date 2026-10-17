/** What the sorting pipeline needs from the outside world: decoding, person detection, number
 * reading, the (admin-only) vision model and goalie spotting. The browser implementation is in
 * browserProviders.ts; the filename-driven mocks below drive tests and the e2e suite. */

import type { JerseyNumberResult, PlayerAnalysisResult } from "../../../../shared/vision/schemas";
import { parseTokens, tokenFor } from "../../../../shared/mockConvention";
import type { RGBAImage } from "../../../ml/ocr/image";
import type { Box } from "../../../lib/geometry";
import type { NumberEvidence } from "../domain";

/** Where a crop came from. Used for usage tracking and the filename-driven mocks. */
export interface DetectionContext { jobId: string; photoId: string; detectionId: string; filename: string; detectionIndex: number }

export interface PlayerCrops { full: RGBAImage; upper: RGBAImage; jersey: RGBAImage }

/** A photo ready for detection: the upright, downscaled copy (pixels and JPEGs to keep). */
export interface Prepared {
  rgba: RGBAImage;
  canvas?: HTMLCanvasElement; // the browser detector reads this
  normalizedJpeg: Blob;
  thumbJpeg: Blob;
  originalWidth: number;
  originalHeight: number;
  /** Free the canvas now (Safari counts canvas memory against a hard limit). */
  dispose?: () => void;
}

export interface PersonDetection { box: Box; confidence: number }

/** The AI number reader. `active()` turns false part way through a job if the server says no
 * (spending limit reached, admin session expired). */
export interface VisionClient {
  active(): boolean;
  identifyJerseyNumber(crops: PlayerCrops, ctx: DetectionContext): Promise<JerseyNumberResult | null>;
  analyzePlayers(crops: PlayerCrops, teamName: string, rosterNumbers: number[], ctx: DetectionContext): Promise<PlayerAnalysisResult | null>;
}

export interface Providers {
  name: string;
  prepare(original: Blob): Promise<Prepared>;
  detect(prepared: Prepared, filename: string): Promise<PersonDetection[]>;
  readNumbers(crops: PlayerCrops, ctx: DetectionContext): Promise<NumberEvidence[]>;
  vision: VisionClient | null;
  goalieProbability: ((crops: PlayerCrops, ctx: DetectionContext) => Promise<number>) | null;
  /** JPEG of a person's crop, to show in review (and to embed for "Pick your jersey"). */
  encodeCrop(img: RGBAImage): Promise<Blob>;
}

// ------------------------------------------------------------------ mocks (port of providers/*/mock.py)

/** One person per filename token, laid out as vertical strips across the image. */
export function mockDetect(prepared: Prepared, filename: string): PersonDetection[] {
  const tokens = parseTokens(filename);
  if (!tokens.length) return [];
  const { width: w, height: h } = prepared.rgba;
  const strip = Math.floor(w / tokens.length);
  return tokens.map((_, i) => ({
    box: { x: i * strip + Math.floor(strip / 10), y: Math.floor(h / 10), width: Math.max(1, Math.floor((strip * 8) / 10)), height: Math.max(1, Math.floor((h * 8) / 10)) },
    confidence: 0.9,
  }));
}

export function mockReadNumbers(ctx: DetectionContext): NumberEvidence[] {
  const t = tokenFor(ctx.filename, ctx.detectionIndex);
  if (!t || t.number === null) return [];
  if (t.kind === "ocr" || t.kind === "goalie") return [{ number: t.number, confidence: 0.95, source: "OCR", region: "jersey" }];
  if (t.kind === "ambiguous") return [{ number: t.number, confidence: 0.7, source: "OCR", region: "jersey" }];
  return []; // "vision": OCR can't read it
}

/** A `g30` token is a goalie, everyone else skates. */
export function mockGoalieProbability(ctx: DetectionContext): number {
  return tokenFor(ctx.filename, ctx.detectionIndex)?.kind === "goalie" ? 0.97 : 0.02;
}

/** The server's mock vision model, for tests that run without a server (same answers). */
export function mockVision(onCall: (op: string) => void = () => {}): VisionClient {
  return {
    active: () => true,
    async identifyJerseyNumber(_c, ctx) {
      onCall("identify_jersey_number");
      const t = tokenFor(ctx.filename, ctx.detectionIndex);
      if (t && t.number !== null && ["ocr", "vision", "goalie"].includes(t.kind)) return { number: t.number, confidence: 0.93, visible: true, notes: "mock" };
      return { number: null, confidence: 0.1, visible: false, notes: "mock" };
    },
    async analyzePlayers(_c, _team, numbers, ctx) {
      onCall("analyze_players");
      const t = tokenFor(ctx.filename, ctx.detectionIndex);
      if (!t || t.number === null) return { jersey_number: null, confidence: 0.05, candidates: [], evidence: [] };
      if (t.kind === "ambiguous") {
        const alt = numbers.find((n) => n !== t.number);
        return { jersey_number: null, confidence: 0.61, evidence: [],
          candidates: [{ jersey_number: t.number, confidence: 0.61 }, ...(alt === undefined ? [] : [{ jersey_number: alt, confidence: 0.27 }])] };
      }
      return { jersey_number: t.number, confidence: 0.9, candidates: [], evidence: [] };
    },
  };
}
