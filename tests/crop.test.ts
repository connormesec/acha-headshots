// Port of the framing tests in the original backend/tests/test_headshots.py.
import { describe, expect, it } from "vitest";
import {
  ASPECT, HEAD_ABOVE_FACE, HEAD_TOP_MARGIN, assess, cropPixels, frameCenter, frameFace,
  isGenericName, normalizeCrop, resolutionFlags, type Box, type Crop,
} from "../src/lib/crop";

const pxRatio = (c: Crop, w: number, h: number) => (c.w * w) / (c.h * h);
const inside = (c: Crop) => {
  const eps = 1e-9;
  return c.x >= -eps && c.y >= -eps && c.x + c.w <= 1 + eps && c.y + c.h <= 1 + eps;
};
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

describe("framing", () => {
  it("face framing is 2:3, centred, with space above the head", () => {
    const [w, h] = [3000, 4000];
    const face = box(1300, 1000, 400, 400);
    const c = frameFace(face, w, h);
    expect(pxRatio(c, w, h)).toBeCloseTo(ASPECT, 6);
    expect(inside(c)).toBe(true);
    expect(Math.abs((c.x + c.w / 2) * w - 1500)).toBeLessThanOrEqual(1);
    const headTop = face.y - HEAD_ABOVE_FACE * face.height;
    expect(Math.abs((headTop - c.y * h) / (c.h * h) - HEAD_TOP_MARGIN)).toBeLessThanOrEqual(0.01);
  });

  it("face near the edge is shifted inside", () => {
    const [w, h] = [2000, 3000];
    const c = frameFace(box(0, 50, 300, 300), w, h);
    expect(inside(c)).toBe(true);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(pxRatio(c, w, h)).toBeCloseTo(ASPECT, 6);
  });

  it("face too big for the image shrinks but keeps the ratio", () => {
    const [w, h] = [800, 900];
    const c = frameFace(box(200, 200, 400, 400), w, h);
    expect(inside(c)).toBe(true);
    expect(pxRatio(c, w, h)).toBeCloseTo(ASPECT, 6);
    expect(c.h).toBeCloseTo(1, 6);
  });

  it.each([[4000, 1000], [1000, 4000], [1000, 1500]])("centre crop is the largest top-aligned box (%i×%i)", (w, h) => {
    const c = frameCenter(w, h);
    expect(inside(c)).toBe(true);
    expect(pxRatio(c, w, h)).toBeCloseTo(ASPECT, 6);
    expect(c.y).toBe(0);
    expect(Math.abs(c.w - 1) < 1e-6 || Math.abs(c.h - 1) < 1e-6).toBe(true);
  });

  it("normalizeCrop fixes the ratio and bounds", () => {
    const c = normalizeCrop(0.9, 0.9, 0.5, 2000, 3000);
    expect(inside(c)).toBe(true);
    expect(pxRatio(c, 2000, 3000)).toBeCloseTo(ASPECT, 6);
    const tall = normalizeCrop(0, 0, 1, 3000, 2000); // full width would be taller than the image
    expect(tall.h).toBeCloseTo(1, 6);
    expect(inside(tall)).toBe(true);
  });

  it("crop pixels are an exact ratio and in bounds", () => {
    for (const [w, h] of [[1001, 1499], [999, 3000], [4032, 3024]]) {
      const { left, top, width, height } = cropPixels(frameCenter(w, h), w, h);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(w);
      expect(top + height).toBeLessThanOrEqual(h);
      expect(Math.abs(width / height - ASPECT)).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("detection failures", () => {
  const [W, H] = [2000, 3000];
  const PERSON = box(400, 300, 1200, 2700);
  const FACE = box(800, 600, 400, 400);

  it("a clear headshot has no flags", () => {
    const a = assess([FACE], [PERSON], W, H);
    expect(a.source).toBe("face");
    expect(a.flags).toEqual([]);
    expect(a.faces).toHaveLength(1);
  });

  it("no face and no person is not a headshot", () => {
    const a = assess([], [], W, H);
    expect(a.source).toBe("center");
    expect(a.flags).toEqual(["not_headshot"]);
    expect(a.crop).toEqual(frameCenter(W, H));
  });

  it("a person without a face uses person framing", () => {
    const a = assess([], [PERSON], W, H);
    expect(a.source).toBe("person");
    expect(a.flags).toContain("no_face");
    expect(inside(a.crop)).toBe(true);
    expect(a.crop.y * H).toBeLessThanOrEqual(PERSON.y);
  });

  it("two similar faces flag a group photo and use the largest", () => {
    const left = box(0, 300, 1000, 2700);
    const right = box(1000, 300, 1000, 2700);
    const big = box(300, 600, 400, 400);
    const other = box(1300, 600, 350, 350);
    const a = assess([other, big], [left, right], W, H);
    expect(a.flags).toContain("multiple_people");
    expect(Math.abs((a.crop.x + a.crop.w / 2) * W - 500)).toBeLessThanOrEqual(2);
    expect(a.faces).toHaveLength(2);
  });

  it("a small face is flagged", () => {
    const a = assess([box(900, 500, 150, 150)], [PERSON], W, H); // 5% of image height
    expect(a.source).toBe("face");
    expect(a.flags).toContain("small_face");
  });

  it("a face outside every person is a false positive", () => {
    const stray = box(1700, 2600, 200, 200);
    const person = box(200, 300, 1000, 2000);
    const a = assess([stray], [person], W, H);
    expect(a.source).toBe("person");
    expect(a.flags).toContain("no_face");
    expect(a.faces).toEqual([]);
  });

  it("tiny faces are ignored", () => {
    expect(assess([box(900, 900, 40, 40)], [], W, H).source).toBe("center");
  });

  it("resolution flags", () => {
    expect(resolutionFlags({ x: 0, y: 0, w: 0.5, h: 0.5 }, 1000)).toEqual(["low_resolution"]); // 500 px
    expect(resolutionFlags({ x: 0, y: 0, w: 0.8, h: 0.8 }, 1000)).toEqual(["upscaled"]); // 800 px
    expect(resolutionFlags({ x: 0, y: 0, w: 0.5, h: 0.5 }, 4000)).toEqual([]);
  });

  it.each([
    ["IMG_1234.jpg", true], ["DSC00012.jpg", true], ["image1.jpg", true], ["PXL_2026.jpg", true],
    ["connor_mesec12.jpg", false], ["Smith 27.jpg", false],
  ])("generic name %s → %s", (name, generic) => {
    expect(isGenericName(name)).toBe(generic);
  });
});
