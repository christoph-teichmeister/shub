// The crab village map, laid out from config.json: one fenced district per group, one house per project.
// Pure and deterministic (seeded random), so the same projects always give the same village.
//
//   top row:     district · forest · district · district …
//   band:        the main road, with a spur up or down to every district gate
//   bottom row:  pond · districts · plaza (your desk, the queue, the town hall) · districts
//
// Ambient extras (lanterns, ducks, tents, machines) attach to the spots this returns; they are not laid out here.

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

export interface VillagePath {
  kind: 'path' | 'cobble';
  /** Width in px. */
  width: number;
  pts: Point[];
}

export interface Decor {
  /** Sprite file name in /village/, without .svg. */
  sprite: string;
  w: number;
  h: number;
  /** Bottom centre. */
  x: number;
  y: number;
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
  /** Centre and size of the round plaza. */
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
  paths: VillagePath[];
  decor: Decor[];
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
const M = 40; // map margin
const GAP = 70; // between districts
const FOREST = 220;
const BAND = 260;
const PLAZA = 420;
const POND = 340; // the pond's slot at the start of the bottom row
const QUEUE = 10;

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

export function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - a[0] - u * dx, py - a[1] - u * dy);
}

export const inRect = (px: number, py: number, r: Rect, margin = 0) =>
  px > r.x - margin && px < r.x + r.w + margin && py > r.y - margin && py < r.y + r.h + margin;

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
        w: 80 + cols * CW,
        h: 160 + rows * CH,
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
    d.y = M + (i % 2) * 40;
    x += d.w + GAP + (i === 0 && top.length > 1 ? FOREST : 0);
  });
  const topEnd = x - GAP;
  const bandY = Math.max(M, ...top.map((d) => d.y + d.h)) + 30;
  const rowY = bandY + BAND;
  let bx = M + POND;
  bl.forEach((d, i) => {
    d.x = bx;
    d.y = rowY + (i % 2) * 34;
    bx += d.w + GAP;
  });
  const plazaCx = bx + PLAZA / 2;
  bx += PLAZA + GAP;
  br.forEach((d, i) => {
    d.x = bx;
    d.y = rowY + ((i + 1) % 2) * 34;
    bx += d.w + GAP;
  });

  const W = Math.max(topEnd, bx - GAP, plazaCx + 280) + M;
  const H = Math.max(rowY + 460, ...bottom.map((d) => d.y + d.h)) + M + 20;
  const plaza = { x: plazaCx, y: H - 150, w: 400, h: 250 };
  const you = { x: plazaCx - 40, y: H - 24 };
  const hall = { x: plazaCx + 118, y: H - 116 };
  const mayor = { x: plazaCx + 30, y: H - 104 };
  const slots: Point[] = [];
  for (let i = 0; i < QUEUE; i++) slots.push([plazaCx - 40 + Math.sin(i * 0.75) * 46, H - 132 - i * 54]);
  const pond = { x: M + POND / 2 - 10, y: rowY + 150 };
  const forest = top.length > 1 ? { x: top[0].x + top[0].w + GAP / 2, y: M, w: FOREST, h: bandY - M - 30 } : null;

  const key = shown.map((p) => p.id + (active.has(p.id) ? '*' : '')).join(',');
  const R = rng(hash(key));
  const jitter = (n: number) => Math.round((R() - 0.5) * n);

  const houses: Record<string, House> = {};
  const lots: World['lots'] = [];
  for (const d of districts) {
    const cell = (i: number, id: string) => {
      const h = hash(id);
      const c = i % d.cols;
      const r = Math.floor(i / d.cols);
      return {
        x: d.x + 30 + c * CW + CW / 2 + ((h % 25) - 12),
        y: d.y + 100 + r * CH + 110 + (c % 2) * 20 + (((h >> 5) % 13) - 6),
      };
    };
    d.projects.forEach((p, i) => {
      const at = cell(i, p.id);
      houses[p.id] = { ...at, project: p, district: d, active: active.has(p.id), desk: { x: at.x + 26, y: at.y + 86 } };
    });
    const lot = cell(d.projects.length, `${d.id}-lot`);
    lots.push({ x: lot.x, y: lot.y + 10, district: d });
  }

  // Main road across the band, a spur to every gate, a stem down to the plaza.
  const roadY = bandY + BAND / 2;
  const gates = [
    ...top.map((d) => ({ x: d.x + d.w / 2, y: d.y + d.h, up: true })),
    ...bottom.map((d) => ({ x: d.x + d.w / 2, y: d.y, up: false })),
  ];
  const stops = [...new Set([...gates.map((g) => Math.round(g.x)), plazaCx])].sort((a, b) => a - b);
  const road: Point[] = stops.map((sx) => [sx, roadY + jitter(40)]);
  const roadAt = (sx: number): Point => road.find((p) => p[0] === Math.round(sx)) ?? [sx, roadY];
  const paths: VillagePath[] = [];
  if (road.length > 1) paths.push({ kind: 'path', width: 40, pts: road });
  for (const g of gates) {
    const from = roadAt(g.x);
    const mid: Point = [g.x + jitter(48), (from[1] + g.y) / 2];
    paths.push({ kind: 'path', width: 36, pts: [from, mid, [g.x, g.y]] });
  }
  paths.push({ kind: 'path', width: 40, pts: [roadAt(plazaCx), [plazaCx, plaza.y - plaza.h / 2 + 20]] });
  paths.push({ kind: 'cobble', width: 34, pts: [[you.x, you.y - 100], ...slots] });

  // Decoration on every free spot of a loose grid; a forest between the first two districts.
  const segs = paths.flatMap((p) => p.pts.slice(1).map((b, i) => [p.pts[i], b, p.width / 2] as const));
  const hallBox = { x: hall.x - 80, y: hall.y - 130, w: 160, h: 140 };
  const youBox = { x: you.x - 70, y: you.y - 110, w: 140, h: 120 };
  const free = (px: number, py: number) =>
    !districts.some((d) => inRect(px, py, d, 26)) &&
    ((px - plaza.x) / (plaza.w / 2 + 40)) ** 2 + ((py - plaza.y) / (plaza.h / 2 + 50)) ** 2 > 1 &&
    ((px - pond.x) / (SIZES.pond[0] / 2 + 20)) ** 2 + ((py - pond.y) / (SIZES.pond[1] / 2 + 30)) ** 2 > 1 &&
    !inRect(px, py, hallBox, 10) &&
    !inRect(px, py, youBox, 10) &&
    !segs.some(([a, b, half]) => distToSegment(px, py, a, b) < half + 18);
  const decor: Decor[] = [];
  const add = (sprite: string, w: number, h: number, px: number, py: number) =>
    decor.push({ sprite, w, h, x: Math.round(px), y: Math.round(py) });
  for (let gy = 40; gy < H + 40; gy += 78) {
    for (let gx = 24; gx < W; gx += 84) {
      const px = gx + (R() - 0.5) * 40;
      const py = gy + (R() - 0.5) * 34;
      const k = R();
      const kind = DECOR.find((d) => k < d[0]);
      if (!kind || !free(px, py) || (forest && inRect(px, py, forest))) continue;
      add(kind[1], kind[2], kind[3], px, py);
    }
  }
  if (forest) {
    for (let fy = forest.y + 90; fy < forest.y + forest.h; fy += 58) {
      for (let fx = forest.x + 30; fx < forest.x + forest.w; fx += 56) {
        const px = fx + (R() - 0.5) * 30;
        const py = fy + (R() - 0.5) * 24;
        if (!free(px, py)) continue;
        if (R() < 0.5) add('tree-pine', 52, 92, px, py);
        else add('tree-oak', 68, 88, px, py);
      }
    }
  }

  return { W, H, districts, houses, lots, plaza, pond, you, hall, mayor, slots, forest, paths, decor };
}
