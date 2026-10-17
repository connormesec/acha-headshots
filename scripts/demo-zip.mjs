/** A synthetic game ZIP that exercises every sorting path with the filename-driven mocks (see
 * shared/mockConvention.ts). Port of devtools/demo_zip.py. Outcomes assume the demo roster below. */

import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import sharp from "sharp";

export const DEMO_ROSTER = [
  ["Alex", "Carter", 1, "G"], ["John", "Smith", 7], ["Ryan", "Miller", 9], ["Mike", "Jones", 12],
  ["Chris", "Anderson", 14], ["Jake", "Wilson", 17], ["Sam", "Brown", 21], ["Bob", "Johnson", 27],
  ["Matt", "Davis", 44], ["Tom", "Wilson", 91],
];

/** [filename, expected outcome] */
export const DEMO_PHOTOS = [
  ["IMG_001_7.jpg", "identified"],
  ["IMG_002_12.jpg", "identified"],
  ["IMG_003_27.jpg", "identified"],
  ["IMG_004_91.jpg", "identified"],
  ["IMG_005_g1.jpg", "identified"], // goalie
  ["IMG_006_9.jpg", "identified"],
  ["IMG_007_14.jpg", "identified"],
  ["IMG_008_17.jpg", "identified"],
  ["IMG_009_21.jpg", "identified"],
  ["IMG_010_44.jpg", "identified"],
  ["IMG_011_v27.jpg", "identified"], // OCR fails; with AI help the vision model reads #27
  ["IMG_012_v12.jpg", "identified"],
  ["IMG_013_7_12.jpg", "identified"], // two players
  ["IMG_014_27_v91_44.jpg", "identified"], // three players
  ["IMG_015_q27.jpg", "review"], // ambiguous
  ["IMG_016_q14.jpg", "review"],
  ["IMG_017_x.jpg", "review"], // no readable number
  ["IMG_018_55.jpg", "review"], // number not on the roster
  ["IMG_019_21_x.jpg", "review"], // one identified, one unknown
  ["IMG_020.jpg", "review"], // no players detected
  ["IMG_021_corrupt.jpg", "failed"], // not a real image
  ["IMG_022_17.png", "identified"],
  ["day2/IMG_023_9.jpg", "identified"], // nested folder
];

const JUNK = { "__MACOSX/._IMG_001_7.jpg": "junk", ".DS_Store": "Bud1", "notes.txt": "not a photo" };

const tokens = (name) => (name.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase().split(/[_\-\s]+/))
  .filter((t) => t === "x" || /^[vqg]?\d{1,2}$/.test(t));

/** Ice, boards, and one green "jersey" with its number per player token. */
export async function renderPhoto(name, width = 960, height = 640) {
  const ts = tokens(name);
  const strip = ts.length ? Math.floor(width / ts.length) : width;
  const players = ts.map((t, i) => {
    const x0 = i * strip + strip / 5, x1 = (i + 1) * strip - strip / 5, y0 = height * 0.18, y1 = height * 0.85;
    const n = t.replace(/^[vqg]/, "");
    return `<circle cx="${(x0 + x1) / 2}" cy="${y0 - 30}" r="34" fill="#282828"/>
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#1e4614"/>
      ${t === "x" ? "" : `<text x="${(x0 + x1) / 2}" y="${height * 0.5}" font-size="${n.length === 1 ? 110 : 90}" font-family="Arial" font-weight="bold" fill="#fafafa" text-anchor="middle">${n}</text>`}`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#ebf0f5"/><rect y="${height * 0.8}" width="100%" height="${height * 0.2}" fill="#c8d2e1"/>${players}</svg>`;
  const img = sharp(Buffer.from(svg));
  return name.toLowerCase().endsWith(".png") ? img.png().toBuffer() : img.jpeg({ quality: 88 }).toBuffer();
}

export async function buildDemoZip() {
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  await zip.add("day2/", undefined, { directory: true });
  for (const [name, outcome] of DEMO_PHOTOS) {
    const data = outcome === "failed" ? Buffer.from("this is not really a jpeg") : await renderPhoto(name);
    await zip.add(name, new Uint8ArrayReader(new Uint8Array(data)));
  }
  for (const [name, text] of Object.entries(JUNK)) await zip.add(name, new Uint8ArrayReader(new TextEncoder().encode(text)));
  return new Uint8Array(await (await zip.close()).arrayBuffer());
}

export function expected() {
  const o = DEMO_PHOTOS.map(([, x]) => x);
  return { total: o.length, identified: o.filter((x) => x === "identified").length, review: o.filter((x) => x === "review").length, failed: o.filter((x) => x === "failed").length };
}
