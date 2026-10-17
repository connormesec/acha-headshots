import { describe, expect, it } from "vitest";
import { applyPatch, needsLook, summary } from "../src/features/headshots/state/ops";
import type { Batch, Item } from "../src/features/headshots/state/types";

const AUTO = { x: 0.2, y: 0.1, w: 0.5, h: 0.5 };

function item(id: string, name: string, extra: Partial<Item> = {}): Item {
  return {
    id, original_filename: name, output_name: name, status: "READY", error_message: null,
    image_url: null, thumbnail_url: null, width: 1000, height: 1500, original_width: 4000, original_height: 6000,
    crop: AUTO, crop_source: "face", flags: [], faces: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.0667 }, { x: 0.6, y: 0.2, w: 0.2, h: 0.1333 }],
    low_resolution: false, included: true, approved: false, needs_look: false, output_bytes: null,
    autoCrop: AUTO, autoFlags: [], rendered: null, ...extra,
  };
}

function batch(items: Item[], extra: Partial<Batch> = {}): Batch {
  return {
    id: "b", name: "Test", status: "READY", items, skipped: [], processed: items.length, compressed: 0,
    error_message: null, zip: null, created_at: "2026-10-03T00:00:00Z", ...extra,
  };
}

const rendered = { blob: new Blob(["x"]), bytes: 1 };
const compressed = () => batch(
  [item("a", "a_10.jpg", { rendered, output_bytes: 1 }), item("b", "b_11.jpg")],
  { status: "COMPRESSED", zip: new Blob(["zip"]) },
);
const get = (b: Batch, id: string) => b.items.find((i) => i.id === id)!;

describe("rename (port of test_rename_validation)", () => {
  const b = batch([item("a", "a_10.jpg"), item("b", "b_11.jpg")]);
  it("rejects a blank name", () => {
    expect(() => applyPatch(b, "a", { output_name: "   " })).toThrow("Type a name for this photo");
  });
  it("rejects a case-insensitive clash", () => {
    expect(() => applyPatch(b, "a", { output_name: "B_11" })).toThrow("Another photo is already named B_11.jpg");
  });
  it("strips paths", () => {
    expect(get(applyPatch(b, "a", { output_name: "../evil" }), "a").output_name).toBe("evil.jpg");
  });
  it("drops a typed image extension", () => {
    expect(get(applyPatch(b, "a", { output_name: "Connor Mesec12.JPG" }), "a").output_name).toBe("Connor Mesec12.jpg");
  });
  it("updates the generic_name flag", () => {
    const named = applyPatch(b, "a", { output_name: "IMG_0001" });
    expect(get(named, "a").flags).toContain("generic_name");
    expect(get(applyPatch(named, "a", { output_name: "jane_doe10" }), "a").flags).not.toContain("generic_name");
  });
});

describe("edits", () => {
  it("reset restores the auto crop and flags", () => {
    const b = batch([item("a", "IMG_1.jpg", { flags: ["generic_name", "small_face", "upscaled"], autoFlags: ["small_face", "upscaled", "generic_name"], low_resolution: true })]);
    const edited = applyPatch(b, "a", { crop: { x: 0, y: 0, w: 0.9 } });
    expect(get(edited, "a").crop_source).toBe("manual");
    expect(get(edited, "a").flags).toEqual(["generic_name"]);
    const approved = applyPatch(edited, "a", { approved: true });
    const reset = get(applyPatch(approved, "a", { reset: true }), "a");
    expect(reset.crop).toEqual(AUTO);
    expect(reset.crop_source).toBe("face");
    expect(reset.approved).toBe(false);
    expect(reset.flags).toEqual(["generic_name", "small_face", "upscaled"]);
    expect(reset.low_resolution).toBe(true);
    expect(reset.needs_look).toBe(true);
  });

  it("reset picks the auto source from the auto flags", () => {
    const b = batch([item("a", "a.jpg", { autoFlags: ["no_face"] }), item("c", "c.jpg", { autoFlags: ["not_headshot"] })]);
    expect(get(applyPatch(b, "a", { reset: true }), "a").crop_source).toBe("person");
    expect(get(applyPatch(b, "c", { reset: true }), "c").crop_source).toBe("center");
  });

  it("a manual crop is 2:3 and flags resolution", () => {
    const b = batch([item("a", "a.jpg")]);
    const c = get(applyPatch(b, "a", { crop: { x: 0.5, y: 0.5, w: 0.1 } }), "a"); // 400 px wide on the original
    expect((c.crop!.w * 1000) / (c.crop!.h * 1500)).toBeCloseTo(2 / 3, 6);
    expect(c.flags).toEqual(["low_resolution"]);
    expect(c.low_resolution).toBe(true);
  });

  it("rename keeps the rendered file; a crop change clears it", () => {
    const renamed = get(applyPatch(compressed(), "a", { output_name: "jane_doe10" }), "a");
    expect(renamed.rendered).toBe(rendered);
    expect(renamed.output_bytes).toBe(1);
    const cropped = get(applyPatch(compressed(), "a", { crop: { x: 0, y: 0, w: 0.6 } }), "a");
    expect(cropped.rendered).toBeNull();
    expect(cropped.output_bytes).toBeNull();
  });

  it("any edit clears the zip and goes back to READY", () => {
    const patches = [
      { output_name: "jane_doe10" }, { crop: { x: 0, y: 0, w: 0.6 } }, { reset: true },
      { face_index: 1 }, { included: false },
    ] as const;
    for (const p of patches) {
      const b = applyPatch(compressed(), "a", p);
      expect(b.zip).toBeNull();
      expect(b.status).toBe("READY");
    }
  });

  it("approving or a no-op include keeps the zip", () => {
    expect(applyPatch(compressed(), "a", { approved: true }).zip).not.toBeNull();
    expect(applyPatch(compressed(), "a", { included: true }).zip).not.toBeNull();
  });

  it("frames on a face (port of test_frame_on_face)", () => {
    const b = batch([item("a", "a.jpg")]);
    const c = get(applyPatch(b, "a", { face_index: 1 }), "a");
    expect(c.crop_source).toBe("manual");
    expect(Math.abs(c.crop!.x + c.crop!.w / 2 - 0.7)).toBeLessThanOrEqual(0.01);
    expect(() => applyPatch(b, "a", { face_index: 5 })).toThrow("That face isn't in this photo");
  });

  it("refuses edits on failed photos and while busy", () => {
    const b = batch([item("a", "a.jpg"), item("f", "f.jpg", { status: "FAILED" })]);
    expect(() => applyPatch(b, "f", { approved: true })).toThrow("This photo couldn't be opened, so it can't be edited");
    expect(() => applyPatch({ ...b, status: "COMPRESSING" }, "a", { approved: true })).toThrow("Please wait");
  });
});

describe("selectors", () => {
  it("needs a look only for hard flags on included, unapproved photos", () => {
    expect(needsLook(item("a", "a.jpg", { flags: ["upscaled", "generic_name"] }))).toBe(false);
    expect(needsLook(item("a", "a.jpg", { flags: ["no_face"] }))).toBe(true);
    expect(needsLook(item("a", "a.jpg", { flags: ["no_face"], approved: true }))).toBe(false);
    expect(needsLook(item("a", "a.jpg", { flags: ["no_face"], included: false }))).toBe(false);
  });

  it("summarises the batch", () => {
    const b = batch([
      item("a", "IMG_1.jpg", { flags: ["generic_name", "no_face"] }),
      item("b", "b.jpg", { included: false }),
      item("c", "c.jpg"),
      item("f", "f.jpg", { status: "FAILED", included: false }),
    ]);
    expect(summary(b)).toEqual({ needs_look: 1, to_compress: 2, excluded: 1, generic_names: 1 });
  });
});
