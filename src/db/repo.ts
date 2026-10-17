/** Reads and writes for the sorting tools. Every change to people or photos goes through here, so
 * the job's counters are recomputed from the rows and can't drift. */

import { computeCounts, settle } from "../features/sorting/services/stats";
import type { BgPick, Detection, Job, Photo, Player, Team, UsageRow } from "../features/sorting/types";
import { db } from "./db";

// ------------------------------------------------------------------ teams

export const listTeams = async () => (await (await db()).getAll("teams")).sort((a, b) => a.name.localeCompare(b.name));
export const getTeam = async (id: string) => (await db()).get("teams", id);
export const teamPlayers = async (teamId: string) =>
  (await (await db()).getAllFromIndex("players", "teamId", teamId)).sort((a, b) =>
    (a.jerseyNumber ?? 1000) - (b.jerseyNumber ?? 1000) || a.lastName.localeCompare(b.lastName));

export async function saveTeam(team: Team, players: Player[], removed: string[] = []) {
  const tx = (await db()).transaction(["teams", "players"], "readwrite");
  await tx.objectStore("teams").put(team);
  for (const p of players) await tx.objectStore("players").put(p);
  for (const id of removed) await tx.objectStore("players").delete(id);
  await tx.done;
}

export async function putPlayer(p: Player) {
  await (await db()).put("players", p);
}

/** A team and its players. Jobs keep their own copy of the team name and the players they tagged. */
export async function deleteTeam(id: string) {
  const d = await db();
  const tx = d.transaction(["teams", "players"], "readwrite");
  for (const key of await tx.objectStore("players").index("teamId").getAllKeys(id)) await tx.objectStore("players").delete(key);
  await tx.objectStore("teams").delete(id);
  await tx.done;
}

// ------------------------------------------------------------------ jobs

export const listJobs = async () => (await (await db()).getAll("jobs")).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
export const getJob = async (id: string) => (await db()).get("jobs", id);
export async function putJob(job: Job) {
  await (await db()).put("jobs", job);
}
export const jobPhotos = async (jobId: string) =>
  (await (await db()).getAllFromIndex("photos", "jobId", jobId)).sort((a, b) => a.order - b.order);
export const jobDetections = async (jobId: string) => (await db()).getAllFromIndex("detections", "jobId", jobId);
export const photoDetections = async (photoId: string) =>
  (await (await db()).getAllFromIndex("detections", "photoId", photoId)).sort((a, b) => a.index - b.index);
export const getPhoto = async (id: string) => (await db()).get("photos", id);
export const getDetection = async (id: string) => (await db()).get("detections", id);

/** Players a job refers to: its team's players (including any no longer on the roster). */
export async function playersById(teamId: string): Promise<Map<string, Player>> {
  return new Map((await (await db()).getAllFromIndex("players", "teamId", teamId)).map((p) => [p.id, p]));
}

export async function putPhotos(photos: Photo[]) {
  const tx = (await db()).transaction("photos", "readwrite");
  for (const p of photos) await tx.store.put(p);
  await tx.done;
}

/** A processed photo, with its people (replacing any from an earlier, interrupted attempt). */
export async function savePhotoResult(photo: Photo, detections: Detection[]) {
  const tx = (await db()).transaction(["photos", "detections"], "readwrite");
  const dets = tx.objectStore("detections");
  for (const key of await dets.index("photoId").getAllKeys(photo.id)) await dets.delete(key);
  for (const d of detections) await dets.put(d);
  await tx.objectStore("photos").put(photo);
  await tx.done;
}

/** Save review changes, then recompute the job's counters and status. Returns the updated job. */
export async function applyReview(jobId: string, change: { detections?: Detection[]; photos?: Photo[] }): Promise<Job> {
  const d = await db();
  const tx = d.transaction(["jobs", "photos", "detections"], "readwrite");
  for (const det of change.detections ?? []) await tx.objectStore("detections").put(det);
  for (const p of change.photos ?? []) await tx.objectStore("photos").put(p);
  const [job, photos, detections] = await Promise.all([
    tx.objectStore("jobs").get(jobId),
    tx.objectStore("photos").index("jobId").getAll(jobId),
    tx.objectStore("detections").index("jobId").getAll(jobId),
  ]);
  if (!job) throw new Error("That job is gone from this browser");
  const next = settle(job, computeCounts(photos, detections));
  await tx.objectStore("jobs").put(next);
  await tx.done;
  return next;
}

/** A job and everything stored for it. */
export async function deleteJob(jobId: string) {
  const d = await db();
  const photos = await d.getAllFromIndex("photos", "jobId", jobId);
  const dets = await d.getAllKeysFromIndex("detections", "jobId", jobId);
  const picks = await d.getAllKeysFromIndex("bgPicks", "jobId", jobId);
  const job = await d.get("jobs", jobId);
  const tx = d.transaction(["jobs", "photos", "detections", "bgPicks", "usage", "blobs"], "readwrite");
  const blobs = tx.objectStore("blobs");
  for (const key of job?.sourceKeys ?? []) await blobs.delete(key);
  for (const p of photos) {
    await blobs.delete(`norm:${p.id}`);
    await blobs.delete(`thumb:${p.id}`);
    await tx.objectStore("photos").delete(p.id);
  }
  for (const k of dets) {
    await blobs.delete(`crop:${k}`);
    await tx.objectStore("detections").delete(k);
  }
  for (const k of picks) {
    await blobs.delete(`bg:${k}`);
    await tx.objectStore("bgPicks").delete(k);
  }
  for (const k of await tx.objectStore("usage").index("jobId").getAllKeys(jobId)) await tx.objectStore("usage").delete(k);
  await tx.objectStore("jobs").delete(jobId);
  await tx.done;
}

// ------------------------------------------------------------------ blobs, usage, picks

export const getBlob = async (key: string) => (await db()).get("blobs", key);
export async function putBlob(key: string, blob: Blob) {
  await (await db()).put("blobs", blob, key);
}
export async function deleteBlob(key: string) {
  await (await db()).delete("blobs", key);
}

export async function addUsage(rows: UsageRow[]) {
  if (!rows.length) return;
  const tx = (await db()).transaction("usage", "readwrite");
  for (const r of rows) await tx.store.add(r);
  await tx.done;
}
export const jobUsage = async (jobId: string) => (await db()).getAllFromIndex("usage", "jobId", jobId);

export const jobPicks = async (jobId: string) => (await db()).getAllFromIndex("bgPicks", "jobId", jobId);
export async function savePicks(put: BgPick[], remove: string[] = []) {
  const tx = (await db()).transaction(["bgPicks", "blobs"], "readwrite");
  for (const p of put) await tx.objectStore("bgPicks").put(p);
  for (const id of remove) {
    await tx.objectStore("bgPicks").delete(id);
    await tx.objectStore("blobs").delete(`bg:${id}`);
  }
  await tx.done;
}
