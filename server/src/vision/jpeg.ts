/** Checks that an upload really is a small JPEG before it's sent on to OpenAI (cost is tied to
 * image size). Reads only the header, no image library on the server. */

export const MAX_IMAGE_SIDE = 768;
export const MAX_IMAGE_BYTES = 300_000;

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Width and height from the frame header, or null if this isn't a well-formed JPEG. */
export function jpegSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan before any frame header
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (SOF.has(marker)) {
      if (len < 7) return null;
      const height = (buf[i + 5] << 8) | buf[i + 6];
      const width = (buf[i + 7] << 8) | buf[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** Decoded bytes, or a user-facing reason it was refused. */
export function checkImage(base64: unknown): { bytes: Buffer } | { error: string } {
  if (typeof base64 !== "string" || !base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) {
    return { error: `The image must be a JPEG of at most ${MAX_IMAGE_BYTES / 1000} KB` };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: "The image isn't valid base64" };
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) return { error: `The image must be at most ${MAX_IMAGE_BYTES / 1000} KB` };
  const size = jpegSize(bytes);
  if (!size) return { error: "The image must be a JPEG" };
  if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
    return { error: `The image must be at most ${MAX_IMAGE_SIDE} px on its long side` };
  }
  return { bytes };
}
