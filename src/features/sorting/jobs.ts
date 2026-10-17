/** Starting a sorting (or player page background) job: keep what was added in this browser and
 * list its photos. Processing happens in runner.ts. */

import { freeSpace, persistStorage } from "../../db/db";
import { putBlob, putJob, putPhotos } from "../../db/repo";
import { entryBase, entryProblem, relPath, tooMany, type Picked, type Skipped } from "../../lib/ingest";
import { sanitizeFilename } from "../../lib/names";
import { readZip } from "../../lib/zipio";
import { SORTING } from "./config";
import type { Job, JobKind, Photo, Team } from "./types";

/** Unique, safe names that keep the extension (the export copies the original files). */
export function uniqueNames(paths: string[]): string[] {
  const taken = new Set<string>();
  return paths.map((p) => {
    const safe = sanitizeFilename(p);
    const dot = safe.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
    let candidate = safe;
    for (let n = 1; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

const emptyCounts = (total: number) => ({ total, processed: 0, identified: 0, review: 0, failed: 0, noPlayers: 0 });

export async function createJob(opts: {
  kind: JobKind;
  team: Team;
  picked: Picked;
  name: string;
  visionRequested: boolean;
  goalieDetection: boolean;
}): Promise<Job> {
  const { picked } = opts;
  const id = crypto.randomUUID();
  const bytes = picked.kind === "zip" ? picked.file.size : picked.files.reduce((t, f) => t + f.size, 0);
  const free = await freeSpace();
  if (free !== null && bytes * 1.3 > free) {
    throw new Error("This browser doesn't have enough free space for these photos. Free up disk space, or sort a smaller batch.");
  }
  void persistStorage();

  const skipped: Skipped[] = [];
  let found: { path: string; source: Photo["source"] }[];
  let sourceKeys: string[];
  if (picked.kind === "zip") {
    const { reader, entries } = await readZip(picked.file);
    try {
      found = [];
      for (const e of entries) {
        const why = entryProblem(e);
        if (why === "hidden") continue;
        if (why) skipped.push({ name: entryBase(e), reason: why });
        else found.push({ path: e.filename, source: { blob: `src:${id}:0`, entry: e.filename } });
      }
    } finally {
      await reader.close().catch(() => {});
    }
    if (found.length > SORTING.maxPhotos) throw new Error(tooMany(found.length, SORTING.maxPhotos));
    if (!found.length) throw new Error("We didn't find any photos we can use in that ZIP.");
    sourceKeys = [`src:${id}:0`];
    await putBlob(sourceKeys[0], picked.file);
  } else {
    skipped.push(...picked.skipped);
    found = picked.files.map((f, i) => ({ path: relPath(f), source: { blob: `src:${id}:${i}` } }));
    sourceKeys = found.map((f) => f.source.blob);
    for (const [i, f] of picked.files.entries()) await putBlob(sourceKeys[i], f);
  }

  found.sort((a, b) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0));
  const names = uniqueNames(found.map((f) => f.path));
  const photos: Photo[] = found.map((f, order) => ({
    id: crypto.randomUUID(), jobId: id, order, filename: names[order], source: f.source,
    width: null, height: null, originalWidth: null, originalHeight: null, status: "PENDING", error: null, reviewed: false,
  }));
  const job: Job = {
    id, kind: opts.kind, teamId: opts.team.id, teamName: opts.team.name, name: opts.name.trim().slice(0, 200) || "Photos",
    status: "CREATED", error: null, skipped: skipped.slice(0, 500), counts: emptyCounts(photos.length),
    createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
    visionRequested: opts.visionRequested, visionStopped: null, goalieDetection: opts.goalieDetection, sourceKeys,
  };
  await putPhotos(photos);
  await putJob(job);
  return job;
}
