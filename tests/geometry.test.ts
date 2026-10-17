/** Port of the pure parts of test_background_filter.py, test_jersey_pick.py and test_player_bg.py. */

import { describe, expect, it } from "vitest";
import type { Box, Crop } from "../src/lib/geometry";
import { normalizeCrop } from "../src/lib/geometry";
import { uniqueOutputName } from "../src/lib/names";
import {
  assessCrop, BANNER_ASPECT, candidateScore, frameAction, resolutionFlags, slug,
} from "../src/features/playerbg/lib/bannerCrop";
import { backgroundReasons, subjectFeatures } from "../src/features/sorting/pipeline/subjectFilter";
import { SORTING } from "../src/features/sorting/config";
import { hideThreshold, normalizeRow, teamScores } from "../src/features/sorting/resolution/jerseyMatch";

const RULE = SORTING.background;
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

describe("background filter", () => {
  it("hides a small blurry person", () => {
    const reasons = backgroundReasons({ relativeHeight: 0.25, relativeSharpness: 0.05, bottom: 0.9 }, RULE);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("small");
    expect(reasons[1]).toContain("out of focus");
  });

  it("hides a small person high in the frame", () => {
    expect(backgroundReasons({ relativeHeight: 0.3, relativeSharpness: 0.9, bottom: 0.2 }, RULE)).toContain("high in the frame (stands)");
  });

  it("keeps a small but sharp person on the ice", () => {
    expect(backgroundReasons({ relativeHeight: 0.3, relativeSharpness: 0.8, bottom: 0.9 }, RULE)).toEqual([]);
  });

  it("never hides a large person", () => {
    expect(backgroundReasons({ relativeHeight: 0.6, relativeSharpness: 0.01, bottom: 0.1 }, RULE)).toEqual([]);
  });

  it("never filters a single-person photo", () => {
    const [f] = subjectFeatures([box(0, 0, 10, 10)], [0], 1000);
    expect(f.relativeHeight).toBe(1);
    expect(backgroundReasons(f, RULE)).toEqual([]);
  });
});

const unit = (...rows: number[][]) => rows.map((r) => normalizeRow(Float32Array.from(r)));

describe("pick your jersey maths", () => {
  it("never compares a seed with itself", () => {
    const scores = teamScores(unit([1, 0], [1, 0.1], [0, 1]), [0]);
    expect(scores[0]).toBeNaN();
    expect(scores[1]).toBeGreaterThan(0.99);
    expect(Math.abs(scores[2])).toBeLessThan(1e-6);
  });

  it("averages the closest seeds", () => {
    const scores = teamScores(unit([1, 0], [0.9, 0.1], [0, 1], [1, 0.05]), [0, 1, 2], 2);
    expect(scores[3]).toBeGreaterThan(scores[2]);
  });

  it("uses the median minus the margin, or the fallback", () => {
    expect(hideThreshold([0.9, 0.8, NaN], 0.15, 0.6, 3)).toBe(0.6);
    // one mis-tagged fan (0.1) among our players doesn't drag the threshold down
    expect(hideThreshold([0.9, 0.85, 0.88, 0.1], 0.15, 0.6, 3)).toBeCloseTo((0.85 + 0.88) / 2 - 0.15, 9);
  });
});

const ratio = (c: Crop, w: number, h: number) => (c.w * w) / (c.h * h);
const inside = (c: Crop) => c.x >= -1e-9 && c.y >= -1e-9 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9;

describe("banner framing", () => {
  it("keeps the ratio and the whole player on a landscape photo", () => {
    const f = frameAction(box(1400, 500, 300, 700), [], 3000, 2000);
    expect(Math.abs(ratio(f.crop, 3000, 2000) - BANNER_ASPECT)).toBeLessThan(1e-6);
    expect(inside(f.crop)).toBe(true);
    expect(f.flags).not.toContain("cut_off");
    expect(f.fill).toBeGreaterThan(0.6);
    expect(f.fill).toBeLessThanOrEqual(0.75);
    expect(Math.abs((f.crop.x + f.crop.w / 2) * 3000 - 1550)).toBeLessThan(1); // centred
  });

  it("pulls a neighbour into frame", () => {
    const f = frameAction(box(1000, 600, 300, 700), [box(1450, 620, 320, 680), box(2700, 100, 80, 160)], 3000, 2000);
    expect(f.context).toBe(1);
    expect(f.crop.x * 3000).toBeLessThanOrEqual(1000);
    expect((f.crop.x + f.crop.w) * 3000).toBeGreaterThanOrEqual(1450 + 320);
    expect(inside(f.crop)).toBe(true);
  });

  it("clamps at the image edge", () => {
    const f = frameAction(box(20, 400, 300, 800), [], 3000, 2000);
    expect(f.crop.x).toBe(0);
    expect(inside(f.crop)).toBe(true);
    expect(Math.abs(ratio(f.crop, 3000, 2000) - BANNER_ASPECT)).toBeLessThan(1e-6);
  });

  it("flags a portrait source as cut off but keeps the head", () => {
    const f = frameAction(box(300, 600, 500, 1600), [], 1200, 2400);
    expect(f.crop.w).toBe(1);
    expect(Math.abs(ratio(f.crop, 1200, 2400) - BANNER_ASPECT)).toBeLessThan(1e-6);
    expect(f.flags).toContain("cut_off");
    expect(f.crop.y * 2400).toBeLessThanOrEqual(600);
  });

  it("doesn't call legs out of frame cut off", () => {
    const f = frameAction(box(1100, 80, 500, 1500), [], 2400, 1600);
    expect(f.crop.w).toBe(1);
    expect(f.flags).not.toContain("cut_off");
    expect(f.crop.y * 1600).toBeLessThanOrEqual(80);
  });

  it("calls a side cut cut off", () => {
    const crop = { x: 0, y: 0.2, w: 0.5, h: (0.5 * 3000) / BANNER_ASPECT / 2000 };
    expect(assessCrop(box(1000, 400, 600, 900), [], crop, 3000, 2000).flags).toContain("cut_off");
  });

  it("prefers the main subject", () => {
    const side = box(100, 500, 300, 700), star = box(1000, 300, 700, 1300);
    expect(assessCrop(side, [star], { x: 0, y: 0, w: 1, h: (1 / BANNER_ASPECT) * 1.5 }, 3000, 2000).prominence).toBeLessThan(0.5);
    expect(frameAction(star, [side], 3000, 2000).prominence).toBe(1);
    expect(candidateScore(0.7, 1, 0.9, 2400, [], 1)).toBeGreaterThan(candidateScore(0.7, 1, 0.9, 2400, [], 0.3));
  });

  it("flags a crowded frame", () => {
    const others = [700, 1550, 1900].map((x) => box(x, 620, 250, 680));
    expect(frameAction(box(1200, 600, 250, 700), others, 3000, 2000).flags).toContain("crowded");
  });

  it("normalises edits to the ratio, inside the image", () => {
    const c = normalizeCrop(0.9, 0.9, 0.5, 3000, 2000, BANNER_ASPECT);
    expect(inside(c)).toBe(true);
    expect(Math.abs(ratio(c, 3000, 2000) - BANNER_ASPECT)).toBeLessThan(1e-6);
    const tall = normalizeCrop(0, 0, 1, 1000, 2000, BANNER_ASPECT);
    expect(tall.w).toBe(1);
    expect(inside(tall)).toBe(true);
  });

  it("flags low resolution", () => {
    const crop = { x: 0, y: 0, w: 0.5, h: 0.2 };
    expect(resolutionFlags(crop, 1000)).toEqual(["low_resolution"]);
    expect(resolutionFlags(crop, 1800)).toEqual(["upscaled"]);
    expect(resolutionFlags(crop, 4000)).toEqual([]);
  });

  it("scores a sharp, well-framed shot highest", () => {
    const good = candidateScore(0.7, 1, 0.95, 2400, []);
    expect(good).toBeGreaterThan(candidateScore(0.7, 0.2, 0.95, 2400, []));
    expect(good).toBeGreaterThan(candidateScore(0.2, 1, 0.95, 2400, []));
    expect(good).toBeGreaterThan(candidateScore(0.7, 1, 0.95, 2400, ["cut_off"]));
  });

  it("names files after the player", () => {
    expect(slug("Max", "Haims")).toBe("max-haims");
    expect(slug("José", "Núñez")).toBe("jose-nunez");
    expect(slug("Jean-Luc", "O'Brien")).toBe("jean-luc-o-brien");
    expect(slug("", "", "Display Only")).toBe("display-only");
    const taken = new Set<string>();
    expect(uniqueOutputName("tom-wilson", taken)).toBe("tom-wilson.jpg");
    expect(uniqueOutputName("tom-wilson", taken)).toBe("tom-wilson-1.jpg");
  });
});
