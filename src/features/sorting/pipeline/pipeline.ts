/** The photo-sorting pipeline, in the browser. Port of processing/pipeline.py:
 *
 *     original -> upright, downscaled copy -> find people -> crops -> background check -> OCR
 *       -> (admin AI fallback) -> IdentityResolver -> saved people and candidate players
 *
 * Each photo is isolated: a failure marks that photo FAILED and processing carries on. Progress is
 * saved after every photo, so a closed tab picks up where it left off. */

import { crop as cropImage, sharpness, type RGBAImage } from "../../../ml/ocr/image";
import { getJob, jobDetections, jobPhotos, putBlob, putJob, savePhotoResult, teamPlayers, getTeam } from "../../../db/repo";
import { PhotoError } from "../../../lib/decode";
import { SORTING } from "../config";
import type { Resolution, Roster } from "../domain";
import { resolve } from "../resolution/identityResolver";
import { applyRole, classifyRole, rosterForRole } from "../resolution/roles";
import { computeCounts, settle } from "../services/stats";
import type { Detection, Job, Match, MatchStatus, Photo, Role } from "../types";
import { jerseyBox, paddedBox, upperBodyBox } from "./crops";
import { collectEvidence } from "./evidence";
import type { DetectionContext, PlayerCrops, Prepared, Providers } from "./providers";
import { SourceReader } from "./sources";
import { backgroundReasons, subjectFeatures } from "./subjectFilter";

export interface Progress { done: number; total: number }

const now = () => new Date().toISOString();
const sub = (img: RGBAImage, b: { x: number; y: number; width: number; height: number }) => cropImage(img, b.x, b.y, b.width, b.height);

export async function loadRoster(teamId: string): Promise<Roster> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("This job's team isn't saved in this browser any more");
  return { team: { id: team.id, name: team.name, abbreviation: team.abbreviation }, players: await teamPlayers(teamId) };
}

/** Process every photo still PENDING. Safe to call again after an interruption. */
export async function processJob(jobId: string, providers: Providers, opts: {
  onProgress?: (p: Progress) => void;
  onPhoto?: (photo: Photo) => void;
  shouldStop?: () => boolean;
} = {}): Promise<Job> {
  let job = await getJob(jobId);
  if (!job) throw new Error("That job is gone from this browser");
  try {
    const roster = await loadRoster(job.teamId);
    job = { ...job, status: "PROCESSING", startedAt: job.startedAt ?? now(), error: null };
    await putJob(job);
    const photos = await jobPhotos(jobId);
    const sources = new SourceReader();
    let done = photos.filter((p) => p.status !== "PENDING").length;
    opts.onProgress?.({ done, total: photos.length });
    for (const photo of photos) {
      if (photo.status !== "PENDING") continue;
      if (opts.shouldStop?.()) {
        job = { ...((await getJob(jobId)) ?? job), status: "PAUSED" };
        await putJob(job);
        return job;
      }
      const result = await processPhoto(job, photo, roster, providers, sources);
      await savePhotoResult(result.photo, result.detections);
      opts.onPhoto?.(result.photo);
      done++;
      opts.onProgress?.({ done, total: photos.length });
      if (done % 10 === 0) {
        job = { ...((await getJob(jobId)) ?? job), counts: computeCounts(await jobPhotos(jobId), await jobDetections(jobId)) };
        await putJob(job);
      }
    }
    job = settle({ ...((await getJob(jobId)) ?? job) }, computeCounts(await jobPhotos(jobId), await jobDetections(jobId)));
    await putJob(job);
    return job;
  } catch (e) {
    const failed: Job = { ...((await getJob(jobId)) ?? job), status: "FAILED", completedAt: now(),
      error: e instanceof Error ? e.message : String(e) };
    await putJob(failed);
    return failed;
  }
}

/** One photo. Never throws: a broken photo comes back FAILED with a message. */
export async function processPhoto(job: Job, photo: Photo, roster: Roster, p: Providers, sources: SourceReader): Promise<{ photo: Photo; detections: Detection[] }> {
  let prepared: Prepared | undefined;
  try {
    prepared = await p.prepare(await sources.original(photo));
    const { rgba } = prepared;
    await putBlob(`norm:${photo.id}`, prepared.normalizedJpeg);
    await putBlob(`thumb:${photo.id}`, prepared.thumbJpeg);
    const sized: Photo = { ...photo, width: rgba.width, height: rgba.height, originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight, error: null };

    const found = await p.detect(prepared, photo.filename);
    if (!found.length) return { photo: { ...sized, status: "NO_PLAYERS" }, detections: [] };

    const W = rgba.width, H = rgba.height;
    const all: PlayerCrops[] = found.map((d) => ({
      full: sub(rgba, paddedBox(d.box, W, H)),
      upper: sub(rgba, upperBodyBox(d.box, W, H)),
      jersey: sub(rgba, jerseyBox(d.box, W, H)),
    }));
    const sharp = all.map((c) => sharpness(c.full));
    const features = subjectFeatures(found.map((d) => d.box), sharp, H);

    const detections: Detection[] = [];
    for (const [index, det] of found.entries()) {
      const crops = all[index];
      const id = crypto.randomUUID();
      const ctx: DetectionContext = { jobId: job.id, photoId: photo.id, detectionId: id, filename: photo.filename, detectionIndex: index };
      await putBlob(`crop:${id}`, await p.encodeCrop(crops.full));
      const base: Detection = {
        id, jobId: job.id, photoId: photo.id, index, box: det.box, confidence: det.confidence, status: "UNKNOWN",
        reasoning: null, goalieScore: null, role: null, sharpness: Math.round(sharp[index] * 1000) / 1000, manual: false,
        observations: [], matches: [],
      };

      let readings;
      const reasons = SORTING.backgroundFilter ? backgroundReasons(features[index], SORTING.background) : [];
      if (reasons.length) {
        // Cheap local OCR decides: a readable number means it's a player after all.
        readings = await p.readNumbers(crops, ctx);
        if (!readings.some((r) => r.number !== null)) {
          detections.push({ ...base, status: "FILTERED", reasoning: `Hidden as background: ${reasons.join(", ")}; no jersey number read` });
          continue;
        }
      }

      let role: Role | null = null, goalieP: number | null = null;
      if (job.goalieDetection && p.goalieProbability) {
        try {
          goalieP = await p.goalieProbability(crops, ctx);
          role = classifyRole(goalieP, SORTING.goalieThreshold, SORTING.skaterThreshold);
        } catch (e) {
          console.warn("goalie check failed", e); // a classifier failure must not fail the photo
        }
      }
      // Goalies are only matched to roster goalies, skaters never to a goalie.
      const candidates = rosterForRole(roster, role);
      const evidence = await collectEvidence(p, crops, ctx, candidates, readings);
      const resolution = applyRole(resolve(candidates, { numbers: evidence.numbers, visions: evidence.vision }), roster, role, goalieP);
      detections.push({
        ...base, goalieScore: goalieP === null ? null : Math.round(goalieP * 1e4) / 1e4, role,
        observations: evidence.observations, ...persisted(resolution),
      });
    }
    return { photo: { ...sized, status: "PROCESSED" }, detections };
  } catch (e) {
    const message = e instanceof PhotoError || e instanceof Error ? e.message : "Something went wrong with this photo";
    return { photo: { ...photo, status: "FAILED", error: message.slice(0, 2000) }, detections: [] };
  } finally {
    prepared?.dispose?.();
  }
}

function persisted(r: Resolution): Pick<Detection, "status" | "reasoning" | "matches"> {
  const flags = r.flags.length ? ` [flags: ${r.flags.join(", ")}]` : "";
  const matches: Match[] = r.candidates.slice(0, SORTING.maxCandidatesStored).map((c, rank) => {
    const status: MatchStatus = rank === 0 && r.status === "AUTO_ACCEPTED" ? "AUTO_ACCEPTED"
      : rank === 0 && r.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "PROPOSED";
    return { id: crypto.randomUUID(), playerId: c.playerId, rank, signals: c.signals, finalScore: c.finalScore, status, reasoning: c.reasoning.slice(0, 2000) };
  });
  return { status: r.status, reasoning: (r.reasoning + flags).slice(0, 4000), matches };
}
