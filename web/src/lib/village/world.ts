// The crab village map, laid out from config.json: one fenced district per group, one house per project.
// Pure and deterministic (seeded random), so the same projects always give the same village.
//
//   top row:     district · forest · district · district …
//   band:        the main road, with a straight spur up or down to every district gate
//   bottom row:  pond · districts · plaza (your desk, the queue, the town hall) · districts
//   outskirts:   a wide margin round it all: meadow, flower fields, rocks, lakes and forest from seeded noise, and a
//                dense forest and shore along the rim, so the world ends in trees and water, never in a cut.
//
// Everything sits on the tile grid of tiles.ts (district rects, gates, roads, the queue lane and the plaza); the
// ground is a material per cell, drawn as autotiles. Lantern posts stand along the paths and round the plaza; the other extras (ducks, tents, machines) attach to the
// spots this returns and are not laid out here.

import { hash2 } from './noise.ts';
import { edgeDistance, material, meadow, rimWidth, SEED } from './terrain.ts';
import { COBBLE, DIRT, FOREST, GRASS, isPath, TILE, type Ground } from './tiles.ts';

export type Point = [number, number];
export type Outfit = 'work' | 'private' | 'everyday' | 'projects';

export interface VillageProject {
  id: string;
  name: string;
  group: string;
  /** Roof and hat colour. */
  color: string;
}

export interface District {
  id: string;
  outfit: Outfit;
  hatName: string;
  projects: VillageProject[];
  cols: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Middle of the gate in the fence towards the road: on the fence line, 2 tiles wide, the spur ends there. */
  gate: Point;
}

export interface House {
  /** Bottom centre of the house sprite. */
  x: number;
  y: number;
  project: VillageProject;
  district: District;
  /** Has a session; without one the house is boarded up. */
  active: boolean;
  /** Bottom centre of its workbench, below the name plate. */
  desk: { x: number; y: number };
}

export interface Decor {
  /** Sprite file name in /village/, without .svg. */
  sprite: string;
  w: number;
  h: number;
  /** Bottom centre. */
  x: number;
  y: number;
  /** Far from every road and building: painted into the ground canvas instead of standing as an element. */
  far: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface World {
  W: number;
  H: number;
  districts: District[];
  houses: Record<string, House>;
  /** The free cell after a district's houses, where "+ New project" goes. */
  lots: { x: number; y: number; district: District }[];
  /** Bounding box of the cobbled plaza (its corner cells stay grass). */
  plaza: Rect;
  /** Centre of the pond sprite. */
  pond: { x: number; y: number };
  /** Bottom centre of your desk, the town hall and the mayor's spot. */
  you: { x: number; y: number };
  hall: { x: number; y: number };
  mayor: { x: number; y: number };
  /** Queue spots in front of your desk, first in line first. */
  slots: Point[];
  forest: Rect | null;
  /** The gates of the districts (`district.gate`), where the spurs meet the fences. */
  gates: Point[];
  /** Dirt roads, the cobbled queue lane and the plaza, a material per tile. */
  ground: Ground;
  decor: Decor[];
  /** Bottom centres of the lantern posts, off the paths and out of the districts. */
  lanterns: Point[];
}

export interface WorldInput {
  /** Group order from config.json; groups only projects name come after. */
  groups: string[];
  projects: VillageProject[];
  /** Projects with a session. */
  active: ReadonlySet<string>;
  /** Leave out projects without a session. */
  activeOnly: boolean;
}

/** Hat per group: by name when it matches, else in turn. */
const OUTFITS: Outfit[] = ['work', 'private', 'everyday', 'projects'];
/** The hat of the i-th group (in district order). */
export const outfitOf = (group: string, i: number): Outfit =>
  OUTFITS.find((o) => o === group.toLowerCase()) ?? OUTFITS[i % OUTFITS.length];
export const HAT_NAMES: Record<Outfit | 'mayor', string> = {
  work: 'hard hat',
  private: 'beanie',
  everyday: 'straw hat',
  projects: 'wizard hat',
  mayor: 'top hat',
};

/** Sprite sizes on the map (twice the SVG's pixel grid). */
export const SIZES = {
  crab: 52,
  house: [96, 92],
  desk: [52, 36],
  lounger: [68, 30],
  hall: [132, 124],
  you: [112, 92],
  pond: [280, 192],
  tent: [56, 44],
  machine: [36, 36],
  lantern: [18, 48],
  /** The "+ New project" button, roughly. */
  lot: [150, 44],
} as const;

// Worktree tents and Docker machines in the gaps beside a house; a neighbour's wall can come within 112 px.
/** At most this many tents and machines by one house; the rest would stand on the neighbours. */
export const MAX_TENTS = 3;
export const MAX_MACHINES = 4;
/** Bottom centre of the i-th tent: right of the house, each further one up and behind. */
export const tentSpot = (h: House, i: number) => ({ x: h.x + 72 + i * 6, y: h.y - 8 - i * 14 });
/** Bottom centre of the i-th machine: left of the house, stacked upwards. */
export const machineSpot = (h: House, i: number) => ({ x: h.x - 72, y: h.y - 8 - i * 34 });

const CW = 184; // house cell: the house, machines on its left, tents on its right
const CH = 176;
// Every layout length below is a whole number of tiles, so district fences, gates and roads share the grid.
const M = 18 * TILE; // the outskirts: map margin on every side
const GAP = 12 * TILE; // between districts
const GROVE = 14 * TILE; // the forest between the first two districts of the top row
const BAND = 22 * TILE;
const PLAZA = 14 * TILE;
const POND = 14 * TILE; // the pond's slot at the start of the bottom row
const QUEUE = 10;
/** Crabs in the queue stand this far apart; the first stands clear of your name plate. The map grows to fit the lane. */
const QUEUE_STEP = 56;
const QUEUE_FIRST = 184;
/** Up to the next grid line. */
const snap = (v: number) => Math.ceil(v / TILE) * TILE;

/** FNV-1a, for per-id jitter. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: a small seeded random in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const inRect = (px: number, py: number, r: Rect, margin = 0) =>
  px > r.x - margin && px < r.x + r.w + margin && py > r.y - margin && py < r.y + r.h + margin;

/** What a flower field is made of: sprite, width, height. */
const FIELD: [string, number, number][] = [
  ['flowers', 28, 18],
  ['flowers', 28, 18],
  ['sunflower', 22, 40],
  ['bush-pink', 44, 30],
  ['bush-yellow', 44, 30],
  ['tallgrass', 28, 22],
];
const DECOR: [number, string, number, number][] = [
  // cumulative chance, sprite, width, height
  [0.1, 'tree-oak', 68, 88],
  [0.17, 'tree-pine', 52, 92],
  [0.25, 'bush-pink', 44, 30],
  [0.32, 'bush-yellow', 44, 30],
  [0.42, 'flowers', 28, 18],
  [0.5, 'tallgrass', 28, 22],
  [0.54, 'rock', 28, 20],
  [0.58, 'mushroom', 20, 20],
  [0.64, 'sunflower', 22, 40],
  [0.66, 'stump', 32, 22],
];

export function buildWorld({ groups, projects, active, activeOnly }: WorldInput): World {
  const names = [...groups];
  for (const p of projects) if (!names.includes(p.group)) names.push(p.group);
  const shown = projects.filter((p) => !activeOnly || active.has(p.id));

  const districts: District[] = names
    .map((id, i) => {
      // Houses with a session first, so the boarded-up ones gather at the back.
      const ps = shown.filter((p) => p.group === id).sort((a, b) => +active.has(b.id) - +active.has(a.id));
      const cells = ps.length + 1; // + the free lot
      const cols = Math.max(2, Math.ceil(Math.sqrt(cells * 1.4)));
      const rows = Math.ceil(cells / cols);
      const outfit = outfitOf(id, i);
      return {
        id,
        outfit,
        hatName: HAT_NAMES[outfit],
        projects: ps,
        cols,
        x: 0,
        y: 0,
        w: snap(80 + cols * CW),
        h: snap(160 + rows * CH),
        gate: [0, 0] as Point,
      };
    })
    .filter((d) => d.projects.length);

  const top = districts.slice(0, Math.ceil(districts.length / 2));
  const bottom = districts.slice(top.length);
  const bl = bottom.slice(0, Math.ceil(bottom.length / 2));
  const br = bottom.slice(bl.length);

  let x = M;
  top.forEach((d, i) => {
    d.x = x;
    d.y = M + (i % 2) * TILE;
    x += d.w + GAP + (i === 0 && top.length > 1 ? GROVE : 0);
  });
  const topEnd = x - GAP;
  const bandY = Math.max(M, ...top.map((d) => d.y + d.h)) + TILE;
  const rowY = bandY + BAND;
  let bx = M + POND;
  bl.forEach((d, i) => {
    d.x = bx;
    d.y = rowY + (i % 2) * TILE;
    bx += d.w + GAP;
  });
  const plazaCx = bx + PLAZA / 2;
  bx += PLAZA + GAP;
  br.forEach((d, i) => {
    d.x = bx;
    d.y = rowY + ((i + 1) % 2) * TILE;
    bx += d.w + GAP;
  });

  const W = snap(Math.max(topEnd, bx - GAP, plazaCx + 280) + M);
  const laneTop = bandY + BAND / 2 + TILE + 24; // the lane starts one tile below the road
  // Hc: the bottom of the village proper; the outskirts add M below it.
  const Hc = Math.max(
    snap(Math.max(rowY + 448, ...bottom.map((d) => d.y + d.h)) + 2 * TILE),
    snap(laneTop + QUEUE_FIRST + (QUEUE - 1) * QUEUE_STEP),
  );
  // The plaza fills the bottom of its slot but one row; your desk stands on it, the queue lane runs up from it.
  const H = snap(Hc + M);
  const plaza = { x: plazaCx - PLAZA / 2, y: Hc - 9 * TILE, w: PLAZA, h: 8 * TILE };
  const laneX = plazaCx - TILE; // the grid line down the middle of the two lane columns
  const you = { x: laneX, y: Hc - 40 };
  // The hall stands 44 px clear of your desk's room (path.ts `blockers`): wide enough to walk between them.
  const hall = { x: plazaCx + 150, y: Hc - 116 };
  const mayor = { x: hall.x - 88, y: Hc - 104 };
  const slots: Point[] = [];
  for (let i = 0; i < QUEUE; i++) slots.push([laneX, Hc - QUEUE_FIRST - i * QUEUE_STEP]);
  const pond = { x: M + POND / 2 - 10, y: rowY + 150 };
  const forest = top.length > 1 ? { x: top[0].x + top[0].w + GAP / 2, y: M, w: GROVE, h: bandY - M - 30 } : null;

  const key = shown.map((p) => p.id + (active.has(p.id) ? '*' : '')).join(',');
  const R = rng(hash(key));

  const houses: Record<string, House> = {};
  const lots: World['lots'] = [];
  for (const d of districts) {
    const cell = (i: number, id: string | null) => {
      const h = id === null ? 0 : hash(id);
      const c = i % d.cols;
      const r = Math.floor(i / d.cols);
      return {
        x: d.x + 30 + c * CW + CW / 2 + (id === null ? 0 : (h % 25) - 12),
        y: d.y + 100 + r * CH + 110 + (c % 2) * 20 + (id === null ? 0 : ((h >> 5) % 13) - 6),
      };
    };
    d.projects.forEach((p, i) => {
      const at = cell(i, p.id);
      houses[p.id] = { ...at, project: p, district: d, active: active.has(p.id), desk: { x: at.x + 26, y: at.y + 86 } };
    });
    // No jitter, and a little to the right: the house before it may lean its way with tents on its right.
    const n = d.projects.length;
    const lot = cell(n, null);
    lots.push({ x: lot.x + (n % d.cols ? 20 : 0), y: lot.y + 10, district: d });
  }

  // Ground: a road along the middle of the band (2 tiles wide), a straight spur from it to every gate, the cobbled
  // plaza with its corners cut and the queue lane from the plaza up to the road.
  const cols = W / TILE;
  const rows = H / TILE;
  const cells = new Uint8Array(cols * rows);
  const fill = (m: number, c0: number, r0: number, c1: number, r1: number, over = false) => {
    for (let r = Math.max(0, r0); r < Math.min(rows, r1); r++)
      for (let c = Math.max(0, c0); c < Math.min(cols, c1); c++)
        if (over || !cells[r * cols + c]) cells[r * cols + c] = m;
  };
  /** A 2-tile-wide run between two grid points on one grid line, one tile past each end so bends close. */
  const run = (m: number, a: Point, b: Point) =>
    fill(
      m,
      Math.min(a[0], b[0]) / TILE - 1,
      Math.min(a[1], b[1]) / TILE - 1,
      Math.max(a[0], b[0]) / TILE + 1,
      Math.max(a[1], b[1]) / TILE + 1,
    );
  const [pc, pr] = [plaza.x / TILE, plaza.y / TILE];
  const [pw, ph] = [plaza.w / TILE, plaza.h / TILE];
  fill(COBBLE, pc, pr, pc + pw, pr + ph);
  for (const [c, r] of [
    [pc, pr],
    [pc + pw - 1, pr],
    [pc, pr + ph - 1],
    [pc + pw - 1, pr + ph - 1],
  ])
    fill(GRASS, c, r, c + 1, r + 1, true);
  const roadY = bandY + BAND / 2;
  fill(COBBLE, laneX / TILE - 1, roadY / TILE + 1, laneX / TILE + 1, pr);
  /** Gates: the grid point in the middle of a district's fence towards the road. */
  const gateX = (d: District) => Math.round((d.x + d.w / 2) / TILE) * TILE;
  for (const d of top) d.gate = [gateX(d), d.y + d.h];
  for (const d of bottom) d.gate = [gateX(d), d.y];
  const spurs: [Point, Point][] = [
    ...top.map((d): [Point, Point] => [
      [gateX(d), roadY],
      [gateX(d), d.y + d.h + TILE],
    ]),
    ...bottom.map((d): [Point, Point] => [
      [gateX(d), roadY],
      [gateX(d), d.y - TILE],
    ]),
  ];
  const stops = [...new Set([...spurs.map((s) => s[0][0]), laneX])].sort((a, b) => a - b);
  const road = stops.map((sx): [Point, Point] => [
    [sx, roadY],
    [sx, roadY],
  ]);
  const runs: [Point, Point][] = [
    ...road.slice(1).map((_, i): [Point, Point] => [road[i][0], road[i + 1][0]]),
    ...spurs,
  ];
  for (const [a, b] of runs) run(DIRT, a, b);
  if (stops.length === 1) run(DIRT, [stops[0], roadY], [stops[0], roadY]);
  const ground: Ground = { cols, rows, cells };
  /** A dirt or cobble tile within m px of the point. */
  const nearPath = (px: number, py: number, m: number) => {
    for (let r = Math.floor((py - m) / TILE); r <= Math.floor((py + m) / TILE); r++)
      for (let c = Math.floor((px - m) / TILE); c <= Math.floor((px + m) / TILE); c++)
        if (c >= 0 && r >= 0 && c < cols && r < rows && isPath(cells[r * cols + c])) return true;
    return false;
  };

  const hallBox = { x: hall.x - 80, y: hall.y - 130, w: 160, h: 140 };
  const youBox = { x: you.x - 70, y: you.y - 110, w: 140, h: 120 };
  const lanterns: Point[] = [];
  const free = (px: number, py: number) =>
    !districts.some((d) => inRect(px, py, d, 26)) &&
    !inRect(px, py, plaza, 40) &&
    ((px - pond.x) / (SIZES.pond[0] / 2 + 20)) ** 2 + ((py - pond.y) / (SIZES.pond[1] / 2 + 30)) ** 2 > 1 &&
    !inRect(px, py, hallBox, 10) &&
    !inRect(px, py, youBox, 10) &&
    !nearPath(px, py, 18) &&
    !lanterns.some(([lx, ly]) => Math.hypot(px - lx, py - ly) < 56);
  // A post is tall: its lamp must stay clear of fences and paths too.
  const freePost = (px: number, py: number) => free(px, py) && free(px, py - SIZES.lantern[1] + 8);

  // Lantern posts: beside the middle of every road section and spur (whichever side is free), and by the plaza.
  for (const [a, b] of runs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const off = TILE + 22;
    const [nx, ny] = [(-(b[1] - a[1]) / len) * off, ((b[0] - a[0]) / len) * off];
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const spot = (
      [
        [mx + nx, my + ny],
        [mx - nx, my - ny],
      ] as Point[]
    ).find(([x, y]) => freePost(x, y) && inRect(x, y, { x: 0, y: 60, w: W, h: H - 60 }));
    if (spot) lanterns.push([Math.round(spot[0]), Math.round(spot[1])]);
  }
  // One in each cut corner of the plaza.
  for (const [x, y] of [
    [plaza.x + TILE / 2, plaza.y + 22],
    [plaza.x + plaza.w - TILE / 2, plaza.y + 22],
    [plaza.x + TILE / 2, plaza.y + plaza.h - 6],
    [plaza.x + plaza.w - TILE / 2, plaza.y + plaza.h - 6],
  ])
    if (!nearPath(x, y, 8)) lanterns.push([x, y]);

  // Outskirts: ground for every cell the roads and districts leave over. Cells within two tiles of a road, a fence,
  // the plaza or the pond stay meadow; the rim is forest with lakes along the shore.
  const keep = new Uint8Array(cols * rows);
  const hold = (x0: number, y0: number, x1: number, y1: number, m: number) => {
    for (let r = Math.max(0, Math.floor((y0 - m) / TILE)); r < Math.min(rows, Math.ceil((y1 + m) / TILE)); r++)
      for (let c = Math.max(0, Math.floor((x0 - m) / TILE)); c < Math.min(cols, Math.ceil((x1 + m) / TILE)); c++)
        keep[r * cols + c] = 1;
  };
  for (const d of districts) hold(d.x, d.y, d.x + d.w, d.y + d.h, 2 * TILE);
  hold(plaza.x, plaza.y, plaza.x + plaza.w, plaza.y + plaza.h, 2 * TILE);
  hold(
    pond.x - SIZES.pond[0] / 2,
    pond.y - SIZES.pond[1] / 2,
    pond.x + SIZES.pond[0] / 2,
    pond.y + SIZES.pond[1] / 2,
    2 * TILE,
  );
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (isPath(cells[r * cols + c])) hold(c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE, 2 * TILE);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (cells[i]) continue;
      const grove = !!forest && inRect((c + 0.5) * TILE, (r + 0.5) * TILE, forest);
      cells[i] = material(c, r, cols, rows, !!keep[i], grove);
    }

  // Decoration: trees on the forest floor, a loose grid of meadow plants (flower fields and rocky patches where the
  // noise says so), never on a path, in a district, the pond or the plaza. What stands far from every road and building
  // is `far`: the view paints it into the ground canvas; the rest stays an element, so it sorts with the crabs.
  const decor: Decor[] = [];
  const near = (px: number, py: number) =>
    nearPath(px, py, 110) ||
    districts.some((d) => inRect(px, py, d, 150)) ||
    inRect(px, py, plaza, 150) ||
    inRect(px, py, hallBox, 150);
  const add = (sprite: string, w: number, h: number, px: number, py: number) => {
    const [x, y] = [Math.round(px), Math.round(py)];
    decor.push({ sprite, w, h, x, y, far: !near(x, y) });
  };
  const matAt = (px: number, py: number) => cells[Math.floor(py / TILE) * cols + Math.floor(px / TILE)];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (cells[r * cols + c] !== FOREST) continue;
      // Thick in the rim, patchy inside.
      const dens = edgeDistance(c, r, cols, rows) < rimWidth(c, r) + 3 ? 0.9 : 0.5;
      for (let k = 0; k < 2; k++) {
        if (hash2(SEED + 10 + k, c, r) > dens - k * 0.4) continue;
        const px = (c + 0.05 + 0.9 * hash2(SEED + 20 + k, c, r)) * TILE;
        const py = (r + 0.35 + 0.55 * hash2(SEED + 30 + k, c, r)) * TILE;
        if (!free(px, py)) continue;
        if (hash2(SEED + 40 + k, c, r) < 0.45) add('tree-pine', 52, 92, px, py);
        else add('tree-oak', 68, 88, px, py);
      }
      const u = hash2(SEED + 50, c, r);
      const [ux, uy] = [(c + 0.05 + 0.9 * hash2(SEED + 51, c, r)) * TILE, (r + 0.9) * TILE];
      if (u < 0.05 && free(ux, uy)) add(u < 0.02 ? 'mushroom' : u < 0.035 ? 'stump' : 'bush-yellow', 32, 24, ux, uy);
    }
  for (let gy = 40; gy < H + 40; gy += 78) {
    for (let gx = 24; gx < W; gx += 84) {
      const px = gx + (R() - 0.5) * 40;
      const py = gy + (R() - 0.5) * 34;
      const k = R();
      if (px < 0 || py < 0 || px >= W || py >= H || matAt(px, py) !== GRASS || !free(px, py)) continue;
      const m = meadow(px / TILE, py / TILE);
      if (m.flowers > 0.62 && k < 0.85) {
        const f = FIELD[Math.floor(R() * FIELD.length)];
        add(f[0], f[1], f[2], px, py);
      } else if (m.rocks > 0.66 && k < 0.5)
        add(k < 0.4 ? 'rock' : 'stump', k < 0.4 ? 28 : 32, k < 0.4 ? 20 : 22, px, py);
      else {
        const kind = DECOR.find((d) => k < d[0]);
        if (kind) add(kind[1], kind[2], kind[3], px, py);
      }
    }
  }

  return {
    W,
    H,
    districts,
    houses,
    lots,
    plaza,
    pond,
    you,
    hall,
    mayor,
    slots,
    forest,
    gates: districts.map((d) => d.gate),
    ground,
    decor,
    lanterns,
  };
}
