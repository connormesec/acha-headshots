export type Kind = "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heic" | "avif" | "unknown";

/** Identify by content, not extension. */
export async function sniff(blob: Blob): Promise<Kind> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const s = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (s(1, 4) === "PNG") return "png";
  if (s(0, 4) === "GIF8") return "gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "webp";
  if (s(0, 2) === "BM") return "bmp";
  if (s(0, 4) === "II*\0" || s(0, 4) === "MM\0*") return "tiff";
  if (s(4, 8) === "ftyp") {
    const brand = s(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
  }
  return "unknown";
}
