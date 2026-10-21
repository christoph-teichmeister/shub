// The village ground: one grid of square cells (TILE px, 16 sprite pixels) with a material per cell, drawn as
// "dual-grid" autotiles. Every tile sits on a cell corner, half a cell off the grid, and picks one of 16 variants
// from the four cells it touches, so edges, outer and inner corners all come from 16 tiles per material.
// Atlases: web/public/village/tiles-<material>.svg (4 × 4 tiles, variant = mask, row by row).

export const TILE = 32;
export const GRASS = 0;
export const DIRT = 1;
export const COBBLE = 2;
/** Outskirts: dark forest floor (trees stand on it) and open water (ponds, lakes, the shore at the rim). */
export const FOREST = 3;
export const WATER = 4;

/** A road or lane tile: what crabs walk on outside the districts. */
export const isPath = (m: number) => m === DIRT || m === COBBLE;

export interface Ground {
  cols: number;
  rows: number;
  /** Material per cell, row by row. */
  cells: Uint8Array;
}

export const cellAt = (g: Ground, c: number, r: number) =>
  c >= 0 && r >= 0 && c < g.cols && r < g.rows ? g.cells[r * g.cols + c] : GRASS;

/** Material under a map point. */
export const groundAt = (g: Ground, x: number, y: number) => cellAt(g, Math.floor(x / TILE), Math.floor(y / TILE));

/** Variant from the four cells round a corner: bit 1 north-west, 2 north-east, 4 south-west, 8 south-east. */
export const cornerMask = (nw: boolean, ne: boolean, sw: boolean, se: boolean) =>
  +nw | (+ne << 1) | (+sw << 2) | (+se << 3);

export interface Autotile {
  /** Top left on the map, in px. */
  x: number;
  y: number;
  /** 1–15, the variant in the atlas. */
  mask: number;
}

/** The tiles of one layer: every corner where `is` holds for at least one of the four cells. */
export function autotiles(g: Ground, is: (material: number) => boolean): Autotile[] {
  const out: Autotile[] = [];
  for (let r = -1; r < g.rows; r++)
    for (let c = -1; c < g.cols; c++) {
      const mask = cornerMask(
        is(cellAt(g, c, r)),
        is(cellAt(g, c + 1, r)),
        is(cellAt(g, c, r + 1)),
        is(cellAt(g, c + 1, r + 1)),
      );
      if (mask) out.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, mask });
    }
  return out;
}

/** Ground layers bottom to top: cobble lies on dirt, so a lane meeting a road gets its curb on the dirt. */
export const LAYERS = [
  { sprite: 'tiles-dirt', is: isPath },
  { sprite: 'tiles-cobble', is: (m: number) => m === COBBLE },
  { sprite: 'tiles-forest', is: (m: number) => m === FOREST },
  { sprite: 'tiles-water', is: (m: number) => m === WATER },
];
