/** Data for photo sorting and player page backgrounds, as stored in this browser (src/db).
 * Ported from the old app's SQL models (models/*.py), with string ids. */

import type { Box, Crop } from "../../lib/geometry";
import type { SourceConfig } from "../../../shared/roster/imported";
import type { UsageRecord } from "../../../shared/vision/schemas";

export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  source: "manual" | "acha" | "puckpress";
  sourceConfig: SourceConfig | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface Player {
  id: string;
  teamId: string;
  externalId: string | null; // the ACHA / team-website player id, so re-syncs update in place
  firstName: string;
  lastName: string;
  displayName: string;
  jerseyNumber: number | null;
  position: string | null; // goalies are always "G"
  headshotUrl: string | null;
  active: boolean;
}

export type JobKind = "sort" | "player_bg";
export type JobStatus = "CREATED" | "EXTRACTING" | "PROCESSING" | "PAUSED" | "REVIEW" | "COMPLETED" | "FAILED";
export type PhotoStatus = "PENDING" | "PROCESSED" | "NO_PLAYERS" | "FAILED";
/** Detection-level outcome. FILTERED: hidden automatically as a background person (a fan in the
 * stands); not in the review queue, but visible and correctable when re-reviewing a photo. */
export type ResolutionStatus = "AUTO_ACCEPTED" | "NEEDS_REVIEW" | "UNKNOWN" | "CONFIRMED" | "REJECTED" | "FILTERED";
export type MatchStatus = "PROPOSED" | "AUTO_ACCEPTED" | "NEEDS_REVIEW" | "CONFIRMED" | "REJECTED";
export type ObservationSource = "OCR" | "VISION_MODEL" | "MANUAL";
export type Role = "goalie" | "skater" | "unsure";

export const RESOLVED: ReadonlySet<ResolutionStatus> = new Set(["AUTO_ACCEPTED", "CONFIRMED"]);
export const UNRESOLVED: ReadonlySet<ResolutionStatus> = new Set(["NEEDS_REVIEW", "UNKNOWN"]);
export const ACTIVE_JOB: ReadonlySet<JobStatus> = new Set(["CREATED", "EXTRACTING", "PROCESSING"]);

export interface Skipped { name: string; reason: string }

export interface JobCounts {
  total: number;
  processed: number;
  identified: number; // photos where everyone is resolved and someone is identified
  review: number;     // photos waiting for a decision
  failed: number;
  noPlayers: number;
}

export interface Job {
  id: string;
  kind: JobKind;
  teamId: string;
  teamName: string;
  name: string; // the ZIP or folder name
  status: JobStatus;
  error: string | null;
  skipped: Skipped[];
  counts: JobCounts;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** An admin turned AI help on for this job. */
  visionRequested: boolean;
  /** Why AI help stopped part way (spending limit, logged out), if it did. */
  visionStopped: string | null;
  goalieDetection: boolean;
  /** Blob keys of what was added: the ZIP, or each photo. */
  sourceKeys: string[];
}

export interface Photo {
  id: string;
  jobId: string;
  order: number;
  filename: string; // sanitized, unique within the job
  /** Where the original lives: a blob key, plus the entry name when it's inside a stored ZIP. */
  source: { blob: string; entry?: string };
  width: number | null; // normalized copy
  height: number | null;
  originalWidth: number | null;
  originalHeight: number | null;
  status: PhotoStatus;
  error: string | null;
  /** A human looked at a photo with no detected players. */
  reviewed: boolean;
}

export interface Observation {
  number: number | null;
  confidence: number;
  source: ObservationSource;
  region: string | null;
  raw?: string | null;
}

export interface Signals { number: number | null; face: number | null; visual: number | null; vision: number | null }

export interface Match {
  id: string;
  playerId: string;
  rank: number;
  signals: Signals;
  finalScore: number;
  status: MatchStatus;
  reasoning: string;
}

export interface Detection {
  id: string;
  jobId: string;
  photoId: string;
  index: number;
  box: Box; // normalized-image pixels
  confidence: number;
  status: ResolutionStatus;
  reasoning: string | null;
  goalieScore: number | null;
  role: Role | null;
  sharpness: number | null;
  /** Added by a reviewer for a photo where nobody was detected: the box is the whole photo. */
  manual: boolean;
  observations: Observation[];
  matches: Match[];
  embedding?: Float32Array | null; // appearance, for "Pick your jersey"
  embeddingModel?: string | null;
}

export interface UsageRow extends UsageRecord {
  id?: number;
  jobId: string;
  photoId: string | null;
  detectionId: string | null;
  at: string;
}

export type BgFlag = "cut_off" | "low_resolution" | "crowded" | "upscaled";

/** The chosen detection (and its banner crop) for one player in a player_bg job. */
export interface BgPick {
  id: string;
  jobId: string;
  playerId: string;
  detectionId: string;
  crop: Crop;
  autoCrop: Crop;
  cropEdited: boolean;
  /** A human picked this shot; automatic re-picks leave it alone. */
  chosen: boolean;
  included: boolean;
  flags: BgFlag[];
  score: number;
  outputBytes: number | null;
}

export const acceptedMatch = (d: Detection): Match | undefined =>
  d.matches.find((m) => m.status === "AUTO_ACCEPTED" || m.status === "CONFIRMED");
