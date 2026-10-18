/** Runs sorting jobs in this tab, one at a time, and tells the pages how far along they are.
 * A Web Lock per job keeps two tabs from processing the same job. Jobs survive a closed tab:
 * open the job again and it carries on from the next unprocessed photo. */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Spend } from "../../app/api";
import { getJob, putJob } from "../../db/repo";
import { browserProviders, warmUp } from "./pipeline/browserProviders";
import { processJob, type Progress } from "./pipeline/pipeline";
import type { Job } from "./types";
import { createVisionClient } from "./vision/client";

export interface RunState {
  running: string | null;
  queued: string[];
  /** Paused by the user in this tab: not started again automatically. */
  paused: string[];
  progress: Record<string, Progress>;
  /** Set while models download before the first photo. */
  loading: string | null;
  error: Record<string, string>;
  version: number; // bumps on every change, for pages that reload from the database
}

let state: RunState = { running: null, queued: [], paused: [], progress: {}, loading: null, error: {}, version: 0 };
const listeners = new Set<() => void>();
const stopRequested = new Set<string>();
let spendListener: ((s: Spend) => void) | null = null;

function set(patch: Partial<RunState>) {
  state = { ...state, ...patch, version: state.version + 1 };
  for (const l of listeners) l();
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const runState = () => state;
export const useRunState = () => useSyncExternalStore(subscribe, runState);

/** Let the header's spending figure follow AI calls. */
export function onSpend(l: ((s: Spend) => void) | null) {
  spendListener = l;
}

export interface RunOptions { admin: boolean }

/** Queue a job (no-op if it's already queued or running). */
export function startJob(jobId: string, opts: RunOptions) {
  if (state.running === jobId || state.queued.includes(jobId)) return;
  stopRequested.delete(jobId);
  set({ queued: [...state.queued, jobId], paused: state.paused.filter((p) => p !== jobId), error: { ...state.error, [jobId]: "" } });
  if (!state.running) void next(opts);
}

/** Pause after the current photo. */
export function pauseJob(jobId: string) {
  set({ queued: state.queued.filter((q) => q !== jobId), paused: [...state.paused, jobId] });
  if (state.running === jobId) stopRequested.add(jobId);
}

async function withLock<T>(name: string, work: () => Promise<T>): Promise<T | "busy"> {
  if (!navigator.locks) return work();
  return navigator.locks.request(name, { ifAvailable: true }, async (lock) => (lock ? work() : "busy"));
}

async function next(opts: RunOptions) {
  const [jobId, ...rest] = state.queued;
  if (!jobId) return;
  set({ running: jobId, queued: rest });
  try {
    const outcome = await withLock(`acha-job:${jobId}`, () => run(jobId, opts));
    if (outcome === "busy") set({ error: { ...state.error, [jobId]: "This job is being processed in another tab." } });
  } catch (e) {
    set({ error: { ...state.error, [jobId]: e instanceof Error ? e.message : String(e) } });
  } finally {
    set({ running: null, loading: null });
    void next(opts);
  }
}

async function run(jobId: string, opts: RunOptions): Promise<Job | undefined> {
  const job = await getJob(jobId);
  if (!job || job.status === "COMPLETED" || job.status === "REVIEW" || job.status === "FAILED") return job;
  set({ loading: jobId });
  try {
    await warmUp();
  } catch {
    throw new Error("Couldn't load the photo models. Check your connection and try again.");
  } finally {
    set({ loading: null });
  }
  const useVision = job.visionRequested && opts.admin;
  const vision = useVision ? createVisionClient((s) => spendListener?.(s)) : null;
  if (job.visionRequested && !opts.admin && !job.visionStopped) {
    await putJob({ ...job, visionStopped: "AI help was asked for, but nobody was logged in as an admin, so these photos used the local reader only." });
  }
  const done = await processJob(jobId, browserProviders({ vision, goalie: job.goalieDetection }), {
    onProgress: (p) => set({ progress: { ...state.progress, [jobId]: p } }),
    shouldStop: () => stopRequested.has(jobId),
  });
  stopRequested.delete(jobId);
  const reason = vision?.stopReason();
  if (reason) {
    const latest = (await getJob(jobId)) ?? done;
    await putJob({ ...latest, visionStopped: reason });
  }
  return done;
}

/** Load something from the database again whenever a job makes progress. */
export function useJobData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | undefined; reload: () => void } {
  const { version } = useRunState();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((d) => live && (setData(d), setError(undefined)), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
