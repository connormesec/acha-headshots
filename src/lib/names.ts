/** File-name rules. Port of zip_ingest.sanitize_filename and the ingest naming. */

const SAFE = /[^A-Za-z0-9._\- ]+/g;
const trimChars = (s: string, chars: string) => s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, "g"), "");

export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".jfif", ".png", ".heic", ".heif", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"];

/** Port of zip_ingest.sanitize_filename. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  let [stem, ext] = dot >= 0 ? [base.slice(0, dot), base.slice(dot + 1)] : [base, ""];
  stem = trimChars(stem.replace(SAFE, "_"), " .") || "photo";
  ext = ext.replace(SAFE, "").toLowerCase();
  return ext ? `${stem.slice(0, 150)}.${ext}` : stem.slice(0, 150);
}

export const stemOf = (name: string) => { const d = name.lastIndexOf("."); return (d > 0 ? name.slice(0, d) : name) || "headshot"; };

export function uniqueOutputName(stem: string, taken: Set<string>): string {
  let candidate = `${stem}.jpg`;
  for (let n = 1; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}.jpg`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** The ZIP's download name. Same rule as the old server's download endpoint. */
export const zipName = (batchName: string) =>
  `${batchName.replace(/[^A-Za-z0-9 _-]/g, "_").trim() || "headshots"} - ACHA headshots.zip`;
