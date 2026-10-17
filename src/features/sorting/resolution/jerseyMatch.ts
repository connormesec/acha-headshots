/** Pure maths for "Pick your jersey": how much does each person look like the players the reviewer
 * marked as our team? Port of resolution/jersey_match.py.
 *
 * Measured on real batches (DINOv2 embeddings, 3 clicked players, margin 0.15): it suggests
 * 55-85% of the non-players waiting for review while wrongly including 0-4% of our players (up to
 * ~18% on a tiny batch). It cannot tell teammates apart. So the output is only ever a *suggestion*
 * the reviewer confirms. */

export const TOP_K = 3;

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Mean of each row's `topK` highest similarities to the seed rows (a seed is never compared with
 * itself). Rows are L2-normalised embeddings. NaN where no other seed exists. */
export function teamScores(vectors: Float32Array[], seedIndex: number[], topK = TOP_K): number[] {
  if (!vectors.length || !seedIndex.length) return vectors.map(() => NaN);
  const k = Math.min(topK, seedIndex.length);
  return vectors.map((v, row) => {
    const sims = seedIndex.filter((s) => s !== row).map((s) => dot(v, vectors[s])).sort((a, b) => b - a).slice(0, k);
    return sims.length ? sims.reduce((t, x) => t + x, 0) / sims.length : NaN;
  });
}

/** Scores below this don't look like our team: `margin` under the median score of our own tagged
 * players (so it adapts to lighting and camera, and one mis-tagged fan can't drag it down), with a
 * fixed fallback for batches with too few tagged players. */
export function hideThreshold(referenceScores: number[], margin: number, fallback: number, minReference: number): number {
  const ref = referenceScores.filter(Number.isFinite).sort((a, b) => a - b);
  if (ref.length < minReference) return fallback;
  const mid = ref.length >> 1;
  const median = ref.length % 2 ? ref[mid] : (ref[mid - 1] + ref[mid]) / 2;
  return median - margin;
}

export function normalizeRow(v: Float32Array): Float32Array {
  const n = Math.max(Math.sqrt(dot(v, v)), 1e-12);
  return v.map((x) => x / n);
}
