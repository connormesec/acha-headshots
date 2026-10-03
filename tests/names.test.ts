import { describe, expect, it } from "vitest";
import { sanitizeFilename, stemOf, uniqueOutputName, zipName } from "../src/lib/names";

describe("sanitizeFilename", () => {
  it("keeps safe names", () => {
    expect(sanitizeFilename("Smith 27.JPG")).toBe("Smith 27.jpg");
  });
  it("takes the basename of any path", () => {
    expect(sanitizeFilename("team/sub\\a_10.jpeg")).toBe("a_10.jpeg");
    expect(sanitizeFilename("../../evil.png")).toBe("evil.png");
  });
  it("replaces unsafe characters and trims dots and spaces", () => {
    expect(sanitizeFilename(" josé (2).heic")).toBe("jos_ _2_.heic");
    expect(sanitizeFilename("...jpg")).toBe("photo.jpg");
  });
  it("cuts long stems to 150 characters", () => {
    expect(stemOf(sanitizeFilename(`${"a".repeat(300)}.jpg`))).toHaveLength(150);
  });
});

describe("uniqueOutputName", () => {
  it("adds -1, -2 … case-insensitively", () => {
    const taken = new Set<string>();
    expect(uniqueOutputName("smith_27", taken)).toBe("smith_27.jpg");
    expect(uniqueOutputName("Smith_27", taken)).toBe("Smith_27-1.jpg");
    expect(uniqueOutputName("smith_27", taken)).toBe("smith_27-2.jpg");
  });
});

describe("zipName", () => {
  it("replaces unsafe characters and falls back to 'headshots'", () => {
    expect(zipName("2026 MSU/roster")).toBe("2026 MSU_roster - ACHA headshots.zip");
    expect(zipName("")).toBe("headshots - ACHA headshots.zip");
  });
});
