/** Tuning for photo sorting. Defaults from the old app (core/config.py), tuned on real games. */

export interface ResolverConfig {
  autoAcceptThreshold: number;
  reviewThreshold: number;
  strongSignalThreshold: number;
  ambiguityMargin: number;
  agreementBoost: number;
  weights: { number: number; face: number; visual: number; vision: number };
}

export const RESOLVER: ResolverConfig = {
  autoAcceptThreshold: 0.9,
  reviewThreshold: 0.6,
  strongSignalThreshold: 0.8,
  ambiguityMargin: 0.15,
  agreementBoost: 0.05,
  weights: { number: 0.5, face: 0.3, visual: 0.1, vision: 0.1 },
};

export const SORTING = {
  /** Local OCR at or above this, on exactly one roster player: no AI call. The browser reader's
   * confidence is calibrated to this scale (src/ml/ocr/reader.ts). */
  ocrAcceptThreshold: 0.85,
  visionAcceptThreshold: 0.8,
  // Background people (fans in the stands): all relative to the others in the same photo.
  backgroundFilter: true,
  background: { maxRelativeHeight: 0.5, maxRelativeSharpness: 0.2, maxBottom: 0.5 },
  // Goalies: at or above goalieThreshold only roster goalies are considered; below
  // skaterThreshold goalies never are; in between it goes to review.
  goalieThreshold: 0.75,
  skaterThreshold: 0.35,
  // "Pick your jersey"
  jerseyMargin: 0.15,
  jerseyFallbackThreshold: 0.6,
  jerseyMinReference: 3,
  normalizedMaxSide: 2400,
  thumbnailMaxSide: 400,
  maxCandidatesStored: 5,
  maxPhotos: 1500,
  maxFileBytes: 60 * 1024 * 1024,
} as const;
