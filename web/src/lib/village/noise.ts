// Seeded value noise for the village outskirts: smooth in [0, 1), no dependencies, the same seed gives the same field.

/** Integer lattice hash to [0, 1). */
function lattice(seed: number, x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** One octave of value noise: bilinear between smoothed lattice points. */
export function valueNoise(seed: number, x: number, y: number): number {
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [smooth(x - x0), smooth(y - y0)];
  const top = lattice(seed, x0, y0) * (1 - fx) + lattice(seed, x0 + 1, y0) * fx;
  const bottom = lattice(seed, x0, y0 + 1) * (1 - fx) + lattice(seed, x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Fractal noise: three octaves, still in [0, 1). `scale` is the size of the biggest feature, in input units. */
export function fbm(seed: number, x: number, y: number, scale: number): number {
  let sum = 0;
  let amp = 0.57;
  let f = 1 / scale;
  for (let o = 0; o < 3; o++, amp /= 2, f *= 2) sum += amp * valueNoise(seed + o * 101, x * f, y * f);
  return sum;
}

/** A seeded random in [0, 1) for one lattice point: stable per cell, whatever else changes. */
export const hash2 = lattice;
