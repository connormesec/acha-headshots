// Synthetic test images for the e2e suite. No real people: shapes, colours and noise only.
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";

const OUT = "test-fixtures";
mkdirSync(OUT, { recursive: true });

const solid = (width, height, background, channels = 3) => sharp({ create: { width, height, channels, background } });

/** Upright 2000×3000: top half red, bottom half blue. Stored 90° counter-clockwise with EXIF
 * orientation 6, so only a reader that applies the rotation sees red on top. */
async function rotated() {
  const half = (color) => solid(1500, 2000, color).png().toBuffer();
  return solid(3000, 2000, "#000")
    .composite([
      { input: await half("#ff0000"), left: 0, top: 0 },
      { input: await half("#0000ff"), left: 1500, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A simple "portrait": grey backdrop with a light disc and shoulders. Not a real face. */
async function portrait() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="4500">
    <rect width="3000" height="4500" fill="#8a9aa8"/>
    <ellipse cx="1500" cy="1400" rx="420" ry="540" fill="#e8c4a0"/>
    <path d="M500 4500 Q600 2300 1500 2300 Q2400 2300 2500 4500 Z" fill="#1d3557"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** 4000×6000 of 4×4-pixel random blocks: the hardest case for the size limit. Plain per-pixel
 * noise would average out when the crop is shrunk to 1000×1500; blocks this size survive.
 * (Chrome still fits this under 2 MB at quality 0.92, so the step-down loop itself is covered
 * by tests/render.test.ts.) */
async function noisy() {
  const small = await sharp(randomBytes(1000 * 1500 * 3), { raw: { width: 1000, height: 1500, channels: 3 } }).png().toBuffer();
  return sharp(small).resize(4000, 6000, { kernel: "nearest" }).jpeg({ quality: 92 }).toBuffer();
}

const files = {
  "portrait.jpg": await portrait(),
  "small.jpg": await solid(400, 600, "#4a7").jpeg().toBuffer(),
  "rotated.jpg": await rotated(),
  "transparent.png": await solid(1200, 1800, { r: 200, g: 0, b: 0, alpha: 0 }, 4)
    .composite([{ input: await solid(600, 900, "#c00").png().toBuffer(), left: 300, top: 450 }])
    .png().toBuffer(),
  "IMG_1234.webp": await solid(1200, 1800, "#357").webp().toBuffer(),
  "badge.gif": await solid(1100, 1650, "#963").gif().toBuffer(),
  "scan.tiff": await solid(1200, 1800, "#579").tiff({ compression: "lzw" }).toBuffer(),
  "noisy.jpg": await noisy(),
  "broken.jpg": Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not really a jpeg ".repeat(40))]),
  "notes.txt": Buffer.from("Roster notes. Not a photo.\n"),
  ".DS_Store": Buffer.from("junk"),
  "__MACOSX/._portrait.jpg": Buffer.from("junk"),
};

const zip = new ZipWriter(new BlobWriter("application/zip"), { level: 0, useWebWorkers: false });
for (const [name, data] of Object.entries(files)) {
  if (!name.includes("/")) writeFileSync(join(OUT, name), data);
  await zip.add(name, new BlobReader(new Blob([data])));
}
writeFileSync(join(OUT, "fixtures.zip"), Buffer.from(await (await zip.close()).arrayBuffer()));
console.log(`Wrote ${Object.keys(files).length} fixtures and fixtures.zip to ${OUT}/`);

// A synthetic game for the sorting e2e tests (filename-driven mocks; see scripts/demo-zip.mjs).
const { buildDemoZip, DEMO_ROSTER } = await import("./demo-zip.mjs");
writeFileSync(join(OUT, "demo-game.zip"), await buildDemoZip());
writeFileSync(join(OUT, "demo-roster.txt"), DEMO_ROSTER.map(([f, l, n, pos]) => `${n} ${f} ${l}${pos ? " G" : ""}`).join("\n"));
console.log(`Wrote demo-game.zip and demo-roster.txt to ${OUT}/`);
