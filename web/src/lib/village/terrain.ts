// The outskirts of the village: which ground material each cell outside the roads and districts gets, and where the
// meadow's flower fields and rocky patches lie. Pure functions of the cell and the seed (noise.ts), so the landscape
// is the same for every village and never changes when projects come and go.
import { fbm } from './noise.ts';
import { FOREST, GRASS, WATER } from './tiles.ts';

export const SEED = 4242;

/** How many cells deep the rim of the world is: dense forest, with lakes along the shore, never a cut. */
export const rimWidth = (c: number, r: number) => 6 + 5 * fbm(SEED + 1, c, r, 9);

/** Distance in cells from the cell to the nearest edge of the world. */
export const edgeDistance = (c: number, r: number, cols: number, rows: number) =>
  Math.min(c, r, cols - 1 - c, rows - 1 - r) + 0.5;

/**
 * Ground for a cell nothing else claims. `keep` cells (beside roads, fences, the plaza and the pond) stay meadow; the
 * rim ignores it (nothing lies that far out). `grove` forces forest floor (the hand-made forest between districts).
 */
export function material(c: number, r: number, cols: number, rows: number, keep: boolean, grove: boolean): number {
  const d = edgeDistance(c, r, cols, rows);
  const rim = rimWidth(c, r);
  if (d < rim) return d < rim - 2.5 && fbm(SEED + 2, c, r, 14) > 0.68 ? WATER : FOREST;
  if (keep) return GRASS;
  if (fbm(SEED + 3, c, r, 16) > 0.69) return WATER;
  return grove || fbm(SEED + 4, c, r, 12) > 0.62 ? FOREST : GRASS;
}

/** Meadow character at a map point in tiles: flowers 0..1 (a field above ~0.62), rocks 0..1 (a rocky patch above ~0.66). */
export const meadow = (tx: number, ty: number) => ({
  flowers: fbm(SEED + 6, tx, ty, 8),
  rocks: fbm(SEED + 7, tx, ty, 9),
});
