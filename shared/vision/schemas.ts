/** Vision-model output. All model output is untrusted and validated here (server side).
 * Port of providers/vision/schemas.py. The browser only imports the types. */

import { z } from "zod";

const number99 = z.number().int().min(0).max(99);
const confidence = z.number().min(0).max(1);

export const JerseyNumberResult = z.object({
  number: number99.nullable().default(null),
  confidence,
  visible: z.boolean(),
  notes: z.string().max(2000).default(""),
});
export type JerseyNumberResult = z.infer<typeof JerseyNumberResult>;

export const RosterNumberCandidate = z.object({ jersey_number: number99, confidence });
export type RosterNumberCandidate = z.infer<typeof RosterNumberCandidate>;

export const PlayerAnalysisResult = z.object({
  jersey_number: number99.nullable().default(null),
  confidence,
  candidates: z.array(RosterNumberCandidate).max(10).default([]),
  evidence: z.array(z.string()).max(20).default([]),
});
export type PlayerAnalysisResult = z.infer<typeof PlayerAnalysisResult>;

/** A number the model itself says is not visible is treated as no observation. */
export const effectiveNumber = (r: JerseyNumberResult) => (r.visible ? r.number : null);

/** Primary answer + alternatives, de-duplicated, best confidence per number, best first. */
export function allCandidates(r: PlayerAnalysisResult): RosterNumberCandidate[] {
  const best = new Map<number, number>();
  if (r.jersey_number !== null) best.set(r.jersey_number, r.confidence);
  for (const c of r.candidates) best.set(c.jersey_number, Math.max(best.get(c.jersey_number) ?? 0, c.confidence));
  return [...best].sort((a, b) => b[1] - a[1]).map(([jersey_number, confidence]) => ({ jersey_number, confidence }));
}

// JSON Schemas sent to the model (OpenAI structured outputs, strict mode).
export const JERSEY_NUMBER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["number", "confidence", "visible", "notes"],
  properties: {
    number: { type: ["integer", "null"] },
    confidence: { type: "number" },
    visible: { type: "boolean" },
    notes: { type: "string" },
  },
} as const;

export const PLAYER_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["jersey_number", "confidence", "candidates", "evidence"],
  properties: {
    jersey_number: { type: ["integer", "null"] },
    confidence: { type: "number" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["jersey_number", "confidence"],
        properties: { jersey_number: { type: "integer" }, confidence: { type: "number" } },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
  },
} as const;

/** One external API call, as returned to the browser with each answer. */
export interface UsageRecord {
  provider: string;
  model: string;
  operation: "identify_jersey_number" | "analyze_players";
  input_tokens: number | null;
  output_tokens: number | null;
  image_bytes: number | null;
  estimated_cost_usd: number;
  duration_ms: number;
  attempts: number;
  success: boolean;
  error: string | null;
}

/** Where a crop came from: for logging, and for the filename-driven mock. */
export interface VisionContext {
  jobId?: string;
  photoId?: string;
  detectionId?: string;
  filename?: string;
  detectionIndex?: number;
}

export interface VisionResponse<T> { result: T | null; usage: UsageRecord }
