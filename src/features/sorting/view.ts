/** Everything a job's pages show, loaded in one go from this browser's database. */

import { getJob, jobDetections, jobPhotos, playersById } from "../../db/repo";
import type { Detection, Job, Photo, Player } from "./types";

export interface JobView {
  job: Job;
  photos: Photo[];
  detections: Detection[];
  players: Map<string, Player>;
}

export async function loadJobView(jobId: string): Promise<JobView | null> {
  const job = await getJob(jobId);
  if (!job) return null;
  const [photos, detections, players] = await Promise.all([jobPhotos(jobId), jobDetections(jobId), playersById(job.teamId)]);
  return { job, photos, detections, players };
}
