/** Every vision call, appended to DATA_DIR/usage-YYYY-MM.jsonl. No photos and nothing about the
 * caller: just what it cost. Read back at startup so the spending caps survive a restart. */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageRecord } from "../../../shared/vision/schemas";

export interface LoggedUsage extends UsageRecord { at: string; job_id: string | null }

export class UsageLog {
  private warned = false;

  constructor(private readonly dir: string | null, private readonly now: () => number = Date.now) {}

  private file(t: number) {
    return join(this.dir!, `usage-${new Date(t).toISOString().slice(0, 7)}.jsonl`);
  }

  async append(rec: UsageRecord, jobId: string | null): Promise<void> {
    if (!this.dir) return;
    const line: LoggedUsage = { at: new Date(this.now()).toISOString(), job_id: jobId, ...rec };
    try {
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.file(this.now()), `${JSON.stringify(line)}\n`, "utf8");
    } catch (e) {
      if (!this.warned) console.warn(`usage log: can't write to ${this.dir}: ${(e as Error).message}`);
      this.warned = true;
    }
  }

  /** This month's calls (a missing or unreadable file is an empty month). */
  async thisMonth(): Promise<LoggedUsage[]> {
    if (!this.dir) return [];
    let text: string;
    try {
      text = await readFile(this.file(this.now()), "utf8");
    } catch {
      return [];
    }
    const out: LoggedUsage[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LoggedUsage);
      } catch {
        /* a half-written last line after a crash */
      }
    }
    return out;
  }
}
