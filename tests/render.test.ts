import { describe, expect, it } from "vitest";
import { PhotoError } from "../src/lib/decode";
import { encodeUnder } from "../src/lib/render";

/** A stand-in canvas whose JPEG size depends only on the quality asked for. */
function fakeCanvas(sizeAt: (q: number) => number) {
  const tried: number[] = [];
  const canvas = {
    toBlob(cb: (b: Blob) => void, _type: string, q: number) {
      tried.push(Math.round(q * 100) / 100);
      cb(new Blob([new Uint8Array(sizeAt(q))]));
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, tried };
}

describe("encodeUnder (port of encode_under)", () => {
  it("keeps the first quality when it fits", async () => {
    const { canvas, tried } = fakeCanvas(() => 1_500_000);
    expect((await encodeUnder(canvas, 2_000_000)).size).toBe(1_500_000);
    expect(tried).toEqual([0.92]);
  });

  it("steps down by 0.04 until it fits", async () => {
    const { canvas, tried } = fakeCanvas((q) => (q > 0.81 ? 2_500_000 : 1_999_999));
    expect((await encodeUnder(canvas, 2_000_000)).size).toBe(1_999_999);
    expect(tried).toEqual([0.92, 0.88, 0.84, 0.8]);
  });

  it("gives up at the floor with a plain message", async () => {
    const { canvas, tried } = fakeCanvas(() => 3_000_000);
    await expect(encodeUnder(canvas, 2_000_000)).rejects.toBeInstanceOf(PhotoError);
    expect(tried.at(-1)).toBe(0.5);
    expect(tried.filter((q) => q === 0.5)).toHaveLength(1);
  });
});
