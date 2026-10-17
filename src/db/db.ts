/** This browser's database for teams, sorting jobs and player page backgrounds.
 *
 * Separate from the headshot tool's store (idb-keyval's default database), whose "Start over"
 * clears everything in it. Nothing here leaves the device. */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BgPick, Detection, Job, Photo, Player, Team, UsageRow } from "../features/sorting/types";

export interface ToolsDB extends DBSchema {
  teams: { key: string; value: Team };
  players: { key: string; value: Player; indexes: { teamId: string } };
  jobs: { key: string; value: Job; indexes: { createdAt: string } };
  photos: { key: string; value: Photo; indexes: { jobId: string } };
  detections: { key: string; value: Detection; indexes: { jobId: string; photoId: string } };
  bgPicks: { key: string; value: BgPick; indexes: { jobId: string } };
  usage: { key: number; value: UsageRow; indexes: { jobId: string } };
  /** Photos and crops. Keys: src:<job>:<n> (what was added), norm:<photo>, thumb:<photo>,
   * crop:<detection>, bg:<pick>. */
  blobs: { key: string; value: Blob };
}

export const DB_NAME = "acha-photo-tools";

let opening: Promise<IDBPDatabase<ToolsDB>> | undefined;

export function db(): Promise<IDBPDatabase<ToolsDB>> {
  return (opening ??= openDB<ToolsDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore("teams", { keyPath: "id" });
      d.createObjectStore("players", { keyPath: "id" }).createIndex("teamId", "teamId");
      d.createObjectStore("jobs", { keyPath: "id" }).createIndex("createdAt", "createdAt");
      d.createObjectStore("photos", { keyPath: "id" }).createIndex("jobId", "jobId");
      const det = d.createObjectStore("detections", { keyPath: "id" });
      det.createIndex("jobId", "jobId");
      det.createIndex("photoId", "photoId");
      d.createObjectStore("bgPicks", { keyPath: "id" }).createIndex("jobId", "jobId");
      d.createObjectStore("usage", { keyPath: "id", autoIncrement: true }).createIndex("jobId", "jobId");
      d.createObjectStore("blobs");
    },
    blocked() {
      console.warn("Close other tabs of this site to finish updating its storage.");
    },
  }).catch((e) => {
    opening = undefined;
    throw e;
  }));
}

/** Tests: forget the open connection (fake-indexeddb is reset between files). */
export function resetDbForTests() {
  opening = undefined;
}

/** Ask the browser not to clear our data when space runs low. Best effort. */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Free space the browser will let us use, or null if it won't say. */
export async function freeSpace(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.quota != null && e.usage != null ? e.quota - e.usage : null;
  } catch {
    return null;
  }
}
