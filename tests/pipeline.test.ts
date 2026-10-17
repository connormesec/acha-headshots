/** Full sorting jobs in Node with the filename-driven mocks and an in-memory IndexedDB.
 * Port of tests/test_pipeline.py and the pipeline parts of the background and goalie tests. */

import "fake-indexeddb/auto";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDemoZip, DEMO_ROSTER, expected } from "../scripts/demo-zip.mjs";
import { db, resetDbForTests } from "../src/db/db";
import { getJob, jobDetections, jobPhotos, saveTeam } from "../src/db/repo";
import { createJob } from "../src/features/sorting/jobs";
import { processJob } from "../src/features/sorting/pipeline/pipeline";
import { mockDetect, mockGoalieProbability, mockReadNumbers, mockVision, type Providers } from "../src/features/sorting/pipeline/providers";
import { acceptedMatch, type Player, type Team } from "../src/features/sorting/types";
import { PhotoError } from "../src/lib/decode";

async function prepare(blob: Blob) {
  try {
    const img = sharp(Buffer.from(await blob.arrayBuffer())).rotate();
    const meta = await img.metadata();
    const { data, info } = await img.clone().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
      rgba: { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height },
      normalizedJpeg: blob, thumbJpeg: blob, originalWidth: meta.width!, originalHeight: meta.height!,
    };
  } catch {
    throw new PhotoError("This file couldn't be opened. It may be damaged, or not really a photo.");
  }
}

const calls: { op: string; filename: string }[] = [];
function providers(opts: { vision?: boolean; goalie?: boolean } = {}): Providers {
  const vision = mockVision();
  return {
    name: "test", prepare, encodeCrop: async () => new Blob(["jpeg"]),
    detect: async (prepared, filename) => mockDetect(prepared, filename),
    readNumbers: async (_crops, ctx) => mockReadNumbers(ctx),
    vision: opts.vision === false ? null : {
      active: () => true,
      identifyJerseyNumber: (c, ctx) => (calls.push({ op: "identify_jersey_number", filename: ctx.filename }), vision.identifyJerseyNumber(c, ctx)),
      analyzePlayers: (c, t, n, ctx) => (calls.push({ op: "analyze_players", filename: ctx.filename }), vision.analyzePlayers(c, t, n, ctx)),
    },
    goalieProbability: opts.goalie === false ? null : async (_c, ctx) => mockGoalieProbability(ctx),
  };
}

let team: Team;
let players: Player[];
beforeEach(async () => {
  // A fresh in-memory database per test.
  (await db()).close();
  indexedDB.deleteDatabase("acha-photo-tools");
  resetDbForTests();
  calls.length = 0;
  team = { id: "msu", name: "MSU Hockey", abbreviation: "MSU", source: "manual", sourceConfig: null, lastSyncedAt: null, createdAt: "" };
  players = DEMO_ROSTER.map(([first, last, n, pos], i) => ({
    id: `p${i}`, teamId: team.id, externalId: null, firstName: first, lastName: last,
    displayName: `${first} ${last}`, jerseyNumber: n, position: pos ?? null, headshotUrl: null, active: true,
  }));
  await saveTeam(team, players);
});

async function runDemo(opts: { vision?: boolean; goalie?: boolean } = {}) {
  const file = new File([await buildDemoZip()], "demo.zip", { type: "application/zip" });
  const job = await createJob({ kind: "sort", team, picked: { kind: "zip", file }, name: "demo", visionRequested: opts.vision !== false, goalieDetection: opts.goalie !== false });
  return processJob(job.id, providers(opts));
}

const byName = async (jobId: string) => {
  const photos = await jobPhotos(jobId);
  const dets = await jobDetections(jobId);
  return (name: string) => {
    const photo = photos.find((p) => p.filename === name)!;
    return { photo, people: dets.filter((d) => d.photoId === photo.id).sort((a, b) => a.index - b.index) };
  };
};
const numberOf = (playerId: string | undefined) => players.find((p) => p.id === playerId)?.jerseyNumber;

describe("sorting pipeline", () => {
  it("runs the demo job end to end", async () => {
    const job = await runDemo();
    const exp = expected();
    expect(job.status).toBe("REVIEW");
    expect(job.counts).toMatchObject({ total: exp.total, processed: exp.total, identified: exp.identified, review: exp.review, failed: exp.failed });
    expect(job.skipped.map((s) => s.name).sort()).toEqual(["notes.txt"]); // __MACOSX and .DS_Store skip silently
  });

  it("keeps several people in one photo apart", async () => {
    const job = await runDemo();
    const { people } = (await byName(job.id))("IMG_014_27_v91_44.jpg");
    expect(people.map((d) => numberOf(acceptedMatch(d)?.playerId))).toEqual([27, 91, 44]);
  });

  it("only asks the vision model when OCR isn't confident", async () => {
    await runDemo();
    const photos = new Set(calls.map((c) => c.filename));
    expect(photos.has("IMG_001_7.jpg")).toBe(false); // confident OCR -> no AI call
    expect(calls.filter((c) => c.filename === "IMG_011_v27.jpg").map((c) => c.op)).toEqual(["identify_jersey_number"]); // confident vision -> no roster analysis
  });

  it("without AI help, the people OCR can't read go to review", async () => {
    const job = await runDemo({ vision: false });
    expect(calls).toEqual([]);
    const get = await byName(job.id);
    expect(get("IMG_011_v27.jpg").people[0].status).toBe("UNKNOWN");
    expect(get("IMG_001_7.jpg").people[0].status).toBe("AUTO_ACCEPTED");
    expect(job.counts.identified).toBe(expected().identified - 3); // v27, v12 and the v91 photo
  });

  it("keeps observations and scores", async () => {
    const job = await runDemo();
    const [d] = (await byName(job.id))("IMG_015_q27.jpg").people;
    expect(d.status).toBe("NEEDS_REVIEW");
    expect(new Set(d.observations.map((o) => o.source))).toEqual(new Set(["OCR", "VISION_MODEL"]));
    const top = d.matches[0];
    expect(numberOf(top.playerId)).toBe(27);
    expect(top.status).toBe("NEEDS_REVIEW");
    expect(top.signals).toMatchObject({ number: 0.7, vision: 0.61 });
    expect(top.finalScore).toBeGreaterThan(0.6);
    expect(d.matches.length).toBeGreaterThanOrEqual(2);
  });

  it("fails a bad photo without failing the job", async () => {
    const job = await runDemo();
    const failed = (await jobPhotos(job.id)).filter((p) => p.status === "FAILED");
    expect(failed.map((p) => p.filename)).toEqual(["IMG_021_corrupt.jpg"]);
    expect(failed[0].error).toMatch(/couldn't be opened/);
  });

  it("matches goalies only to roster goalies", async () => {
    const job = await runDemo();
    const [g] = (await byName(job.id))("IMG_005_g1.jpg").people;
    expect(g.role).toBe("goalie");
    expect(numberOf(acceptedMatch(g)?.playerId)).toBe(1);
  });

  it("picks up where it left off", async () => {
    const file = new File([await buildDemoZip()], "demo.zip");
    const created = await createJob({ kind: "sort", team, picked: { kind: "zip", file }, name: "demo", visionRequested: true, goalieDetection: true });
    let n = 0;
    const paused = await processJob(created.id, providers(), { shouldStop: () => ++n > 5 });
    expect(paused.status).toBe("PAUSED");
    expect((await jobPhotos(created.id)).filter((p) => p.status !== "PENDING")).toHaveLength(5);
    const done = await processJob(created.id, providers());
    expect(done.counts.processed).toBe(expected().total);
    expect((await getJob(created.id))!.status).toBe("REVIEW");
  });
});
