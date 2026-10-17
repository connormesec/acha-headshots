/** Tiny pixel helpers on plain RGBA arrays, so the number reader runs the same in the browser and
 * in Node (tests, the OCR evaluation script). */

export interface RGBAImage { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** Bilinear resize. */
export function resize(img: RGBAImage, width: number, height: number): RGBAImage {
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = img.width / width, sy = img.height / height;
  const src = img.data;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(img.height - 1, Math.floor(fy)), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(img.width - 1, Math.floor(fx)), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
      const a = (y0 * img.width + x0) * 4, b = (y0 * img.width + x1) * 4, c = (y1 * img.width + x0) * 4, d = (y1 * img.width + x1) * 4;
      const o = (y * width + x) * 4;
      for (let k = 0; k < 4; k++) {
        out[o + k] = (src[a + k] * (1 - wx) + src[b + k] * wx) * (1 - wy) + (src[c + k] * (1 - wx) + src[d + k] * wx) * wy;
      }
    }
  }
  return { data: out, width, height };
}

/** Area average when shrinking a lot (bilinear alone aliases), bilinear otherwise. */
export function scaleTo(img: RGBAImage, width: number, height: number): RGBAImage {
  let cur = img;
  while (cur.width >= width * 2 && cur.height >= height * 2) cur = halve(cur);
  return cur.width === width && cur.height === height ? cur : resize(cur, width, height);
}

function halve(img: RGBAImage): RGBAImage {
  const w = Math.floor(img.width / 2), h = Math.floor(img.height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ((2 * y) * img.width + 2 * x) * 4, b = a + 4, c = a + img.width * 4, d = c + 4, o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (img.data[a + k] + img.data[b + k] + img.data[c + k] + img.data[d + k]) / 4;
    }
  }
  return { data: out, width: w, height: h };
}

/** Quarter turn: clockwise (cw) or counter-clockwise. */
export function rotate90(img: RGBAImage, cw: boolean): RGBAImage {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // new image is h wide, w tall
      const nx = cw ? h - 1 - y : y, ny = cw ? x : w - 1 - x;
      const i = (y * w + x) * 4, o = (ny * h + nx) * 4;
      out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = img.data[i + 3];
    }
  }
  return { data: out, width: h, height: w };
}

export function crop(img: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.max(1, Math.min(img.width - x, Math.ceil(w))); h = Math.max(1, Math.min(img.height - y, Math.ceil(h)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { data: out, width: w, height: h };
}

/** Gray with stretched contrast (1st..99th percentile), optionally inverted: light-on-dark and
 * dark-on-light jerseys both end up as dark digits on a light ground in one of the two. */
export function contrastGray(img: RGBAImage, invert: boolean): RGBAImage {
  const n = img.width * img.height;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]);
    gray[i] = g;
    hist[g]++;
  }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    let g = ((gray[i] - lo) * 255) / span;
    if (invert) g = 255 - g;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

/** Variance of the Laplacian on gray: high for in-focus detail, low for blur (port of
 * subject_filter.sharpness). Only compared within one photo, so the scale doesn't matter. */
export function sharpness(img: RGBAImage): number {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return 0;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += lap; sum2 += lap * lap; n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}
