// Draws the 16-bit pixel-art sprites of the Crab Village (crabs, hats, houses, trees, tiles, pond, props)
// as pixel grids and writes each one as an SVG with one <rect> per horizontal colour run.
// Run: node scripts/village/sprites.ts [outDir]   (default web/public/village/; outputs are committed)
// Noise uses a seeded PRNG, so every run gives the same bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Pixel = [hex: string, alpha: number] | null;
type Pt = [number, number];

const key = (x: number, y: number) => `${x},${y}`;
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Python's round(): halves go to the even neighbour. */
const pyRound = (v: number) => (Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : Math.round(v));

/** mulberry32: small seeded PRNG with Python-random-like helpers. */
function rng(seed: number) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    uniform: (a: number, b: number) => a + (b - a) * random(),
    randint: (a: number, b: number) => a + Math.floor(random() * (b - a + 1)),
    choice: <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)],
  };
}

class Px {
  readonly w: number;
  readonly h: number;
  p: Pixel[][];
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.p = Array.from({ length: h }, () => Array<Pixel>(w).fill(null));
  }

  set(x: number, y: number, c: string, a = 1) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.p[y][x] = [c, a];
  }

  get(x: number, y: number): Pixel {
    return x >= 0 && x < this.w && y >= 0 && y < this.h ? this.p[y][x] : null;
  }

  solid(x: number, y: number) {
    const c = this.get(x, y);
    return c !== null && c[1] >= 0.99;
  }

  /** Alpha overlay only where a solid pixel exists (shading). */
  over(x: number, y: number, c: string, a: number) {
    if (!this.solid(x, y)) return;
    const [r1, g1, b1] = rgb(this.p[y][x]![0]);
    const [r2, g2, b2] = rgb(c);
    const mix = (u: number, v: number) => pyRound(u * (1 - a) + v * a);
    this.p[y][x] = [hex(mix(r1, r2), mix(g1, g2), mix(b1, b2)), 1];
  }

  /** Paints every empty or translucent pixel that touches a solid one. */
  outline(c: string) {
    const add: Pt[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.solid(x, y)) continue;
        if (this.solid(x + 1, y) || this.solid(x - 1, y) || this.solid(x, y + 1) || this.solid(x, y - 1))
          add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
  }

  svg(): string {
    const rects: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let x = 0;
      while (x < this.w) {
        const c = this.p[y][x];
        if (c === null) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < this.w && this.p[y][x]?.[0] === c[0] && this.p[y][x]?.[1] === c[1]) x++;
        const op = c[1] >= 0.99 ? '' : ` fill-opacity="${c[1].toFixed(2)}"`;
        rects.push(`<rect x="${x0}" y="${y}" width="${x - x0}" height="1" fill="${c[0]}"${op}/>`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  }
}

function rgb(h: string): number[] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function hex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = Math.trunc(cy - ry - 1); y < Math.trunc(cy + ry + 2); y++)
    for (let x = Math.trunc(cx - rx - 1); x < Math.trunc(cx + rx + 2); x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) pts.push([x, y]);
  return pts;
}

function rrectPts(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      if (dx * dx + dy * dy <= r * r + 0.5) pts.push([x, y]);
    }
  return pts;
}

function rampPick(ramp: readonly string[], t: number) {
  t = Math.min(Math.max(t, 0), 0.999);
  return ramp[Math.floor(t * ramp.length)];
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

// ---------------- crab ----------------
const CLAY = ['#7a2f1c', '#a8492c', '#c9603f', '#d97757', '#e8946f', '#f5b896'];
const CRAB_OUT = '#3a160c';
const CLAW = ['.XX.XX', 'XXX.XX', 'XXXXXX', 'XXXXXX', '.XXXX.', '..XX..'];

function crab(pose: string, frame: number) {
  const c = new Px(26, 26);
  for (const [x, y] of ellipsePts(12.5, 23.6, 9.5, 1.6)) c.set(x, y, '#000000', 0.28);
  const sleep = pose === 'sleep';
  const top = sleep ? 12 : 10;
  const bot = sleep ? 21 : 20;
  for (const [x, y] of rrectPts(4, top, 21, bot, sleep ? 4 : 3)) {
    const t = (y - top) / (bot - top);
    const side = x < 9 ? 0.12 : x > 17 ? -0.12 : 0;
    c.set(x, y, rampPick(CLAY, 0.92 - t * 0.75 + side));
  }
  c.set(7, top + 1, CLAY[5]);
  c.set(8, top + 1, CLAY[5]);
  c.set(9, top + 1, CLAY[4]);
  c.set(6, top + 2, CLAY[4]);

  const claw = (ox: number, oy: number, mirror: boolean) => {
    CLAW.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch === 'X') c.set(ox + (mirror ? 5 - i : i), oy + j, rampPick(CLAY, 0.85 - j * 0.12));
      }),
    );
    c.set(ox + (mirror ? 4 : 1), oy + 1, CLAY[5]);
  };

  if (sleep) {
    claw(0, 15, false);
    claw(20, 15, true);
  } else {
    const ly = pose === 'work' && frame === 0 ? 3 : 6;
    const ry = pose === 'work' && frame === 1 ? 3 : 6;
    claw(0, ly, false);
    claw(20, ry, true);
    for (let y = ly + 6; y < 16; y++) {
      c.set(2, y, CLAY[2]);
      c.set(3, y, CLAY[3]);
    }
    for (let y = ry + 6; y < 16; y++) {
      c.set(22, y, CLAY[2]);
      c.set(23, y, CLAY[1]);
    }
    [6, 9, 12, 13, 16, 19].forEach((x, k) => {
      const lift = pose === 'walk' && k % 2 === frame;
      const dx = x < 13 ? -1 : 1;
      const y0 = bot + 1;
      c.set(x, y0, CLAY[1]);
      c.set(x + dx, y0 + 1, CLAY[1]);
      if (!lift) c.set(x + dx, y0 + 2, CLAY[0]);
    });
  }
  // face
  const E = '#2a1410';
  const ey = top + 3;
  if (sleep || pose === 'blink') {
    for (const x of [8, 9, 16, 17]) c.set(x, ey + 2, E);
    c.set(7, ey + 1, E);
    c.set(18, ey + 1, E);
  } else {
    for (const x of [8, 9, 16, 17]) for (const y of [ey, ey + 1, ey + 2]) c.set(x, y, E);
    c.set(8, ey, '#ffffff');
    c.set(16, ey, '#ffffff');
  }
  for (const [x, y] of [
    [11, ey + 4],
    [12, ey + 5],
    [13, ey + 5],
    [14, ey + 4],
  ])
    c.set(x, y, '#5a2014');
  for (const x of [6, 7, 18, 19]) c.over(x, ey + 4, '#ff8a9a', 0.55);
  c.outline(CRAB_OUT);
  return c;
}

// ---------------- hats (mask = project colour, detail = outline/shading/opaque bits) ----------------
const HAT_OUT = '#2a1a10';

function hat(
  out: Map<string, Px>,
  name: string,
  maskPts: Pt[],
  opaque: Map<string, string>,
  shade: Map<string, [string, number]>,
  top = new Map<string, string>(),
) {
  const m = new Px(26, 26);
  const union = new Px(26, 26);
  for (const [x, y] of maskPts) {
    m.set(x, y, '#000000');
    union.set(x, y, '#000000');
  }
  const d = new Px(26, 26);
  for (const [k, col] of opaque) {
    const [x, y] = k.split(',').map(Number);
    d.set(x, y, col);
    union.set(x, y, '#000000');
  }
  union.outline('#ff00ff');
  for (let y = 0; y < 26; y++)
    for (let x = 0; x < 26; x++) if (union.get(x, y)?.[0] === '#ff00ff') d.set(x, y, HAT_OUT);
  const inMask = new Set(maskPts.map(([x, y]) => key(x, y)));
  for (const [k, [col, a]] of shade) {
    const [x, y] = k.split(',').map(Number);
    if (inMask.has(k) && !opaque.has(k)) d.set(x, y, col, a);
  }
  for (const [k, col] of top) {
    const [x, y] = k.split(',').map(Number);
    d.set(x, y, col);
  }
  out.set(`hat-${name}-mask`, m);
  out.set(`hat-${name}-detail`, d);
}

function uniq(pts: Pt[]): Pt[] {
  return [...new Map(pts.map((p) => [key(...p), p])).values()];
}

function hats(out: Map<string, Px>) {
  // hard hat
  let mask = uniq([
    ...ellipsePts(12.5, 10, 7, 6).filter(([, y]) => y <= 9),
    ...range(4, 22).flatMap((x): Pt[] => [
      [x, 9],
      [x, 10],
    ]),
  ]);
  let shade = new Map<string, [string, number]>();
  for (const [x, y] of mask) {
    if (y >= 7 && x >= 15 && y <= 9) shade.set(key(x, y), ['#000000', 0.25]);
    if (y === 10) shade.set(key(x, y), ['#000000', 0.32]);
    if ((x === 12 || x === 13) && y <= 8) shade.set(key(x, y), ['#ffffff', 0.28]);
  }
  for (const k of ['8,6', '9,5', '9,6', '10,5']) shade.set(k, ['#ffffff', 0.45]);
  hat(out, 'work', mask, new Map(), shade);

  // beanie
  mask = uniq([
    ...ellipsePts(12.5, 10.5, 7, 6.5).filter(([, y]) => y <= 8),
    ...range(5, 21).flatMap((x): Pt[] => [
      [x, 8],
      [x, 9],
      [x, 10],
    ]),
  ]);
  shade = new Map();
  for (const [x, y] of mask) {
    if (y >= 8 && x % 2 === 0) shade.set(key(x, y), ['#000000', 0.25]);
    else if (y < 8 && x % 3 === 0) shade.set(key(x, y), ['#000000', 0.12]);
    if (y < 8 && x >= 16) shade.set(key(x, y), ['#000000', 0.22]);
  }
  for (const k of ['9,5', '10,5', '9,6']) shade.set(k, ['#ffffff', 0.38]);
  const pom = new Map<string, string>();
  for (const [x, y] of ellipsePts(12.5, 3, 2.6, 2.4)) pom.set(key(x, y), x <= 12 && y <= 3 ? '#f8f8f2' : '#d6d6c8');
  hat(out, 'private', mask, pom, shade);

  // straw hat: straw is opaque, the band takes the project colour
  const STRAW = ['#8a6a2a', '#c9a24a', '#e3c46a', '#f3dc8a'];
  const straw = new Map<string, string>();
  for (const [x, y] of [...rrectPts(8, 4, 17, 8, 2), ...ellipsePts(12.5, 9.6, 11.5, 2)]) {
    let base = y < 8 ? 2 : 1;
    if ((x + y) % 2 === 0) base++;
    if (x > 16) base--;
    straw.set(key(x, y), STRAW[Math.max(0, Math.min(3, base))]);
  }
  const band = range(8, 18).flatMap((x): Pt[] => [
    [x, 6],
    [x, 7],
  ]);
  for (const [x, y] of band) straw.delete(key(x, y));
  shade = new Map();
  for (const [x, y] of band) if (y === 6) shade.set(key(x, y), ['#ffffff', 0.22]);
  for (const [x, y] of band) if (x >= 15) shade.set(key(x, y), ['#000000', 0.22]);
  hat(out, 'everyday', band, straw, shade);

  // wizard hat
  const wiz: Pt[] = [];
  for (let y = 0; y < 9; y++) {
    const hw = 1 + y * 0.62;
    const shift = y < 3 ? 1.5 : y < 5 ? 0.6 : 0;
    for (let x = 0; x < 26; x++) if (Math.abs(x + 0.5 - (12.5 + shift)) <= hw) wiz.push([x, y]);
  }
  mask = uniq([...wiz, ...ellipsePts(12.5, 9.6, 9.5, 1.7)]);
  shade = new Map();
  for (const [x, y] of mask) {
    if (x >= 14 && y < 9) shade.set(key(x, y), ['#000000', 0.25]);
    if (y >= 9) shade.set(key(x, y), x > 14 ? ['#000000', 0.2] : ['#ffffff', 0.15]);
  }
  const stars = new Map([
    ['11,5', '#ffe066'],
    ['14,2', '#ffe066'],
    ['13,7', '#fff4b0'],
    ['10,7', '#ffe066'],
  ]);
  hat(out, 'projects', mask, new Map(), shade, stars);
}

// ---------------- house ----------------
const WOOD = ['#4a2a12', '#6a3e1c', '#8a5428', '#a86a34', '#c4844a', '#d89c62'];
const STONE = ['#4a4a46', '#6a6a64', '#8a8a82', '#a8a89e', '#c4c4b8'];
const OUTL = '#2a1408';

function house(out: Map<string, Px>) {
  const rnd = rng(7);
  const b = new Px(48, 46);
  for (const [x, y] of ellipsePts(24, 44, 24, 2)) b.set(x, y, '#000000', 0.25);
  // chimney
  for (let y = 0; y < 13; y++)
    for (let x = 33; x < 39; x++) {
      const brick = y % 3 === 2 || (x + Math.floor(y / 3) * 2) % 5 === 0;
      b.set(x, y, brick ? STONE[1] : rampPick(STONE, 0.75 - y * 0.03 - (x > 36 ? 0.15 : 0)));
    }
  for (let x = 32; x < 40; x++) b.set(x, 0, STONE[0]);
  // walls
  for (let y = 19; y < 41; y++)
    for (let x = 4; x < 44; x++) {
      const t = 0.7 - (x > 34 ? 0.2 : 0) + (x < 12 ? 0.1 : 0);
      const seam = (y - 19) % 3 === 2;
      b.set(x, y, seam ? WOOD[1] : rampPick(WOOD.slice(1), t));
      if (rnd.random() < 0.05 && !seam) b.set(x, y, WOOD[2]);
    }
  for (let y = 19; y < 41; y++) for (const x of [4, 5, 42, 43]) b.set(x, y, x === 5 || x === 43 ? WOOD[1] : WOOD[0]);
  // stone foundation
  for (let y = 40; y < 43; y++) for (let x = 3; x < 45; x++) b.set(x, y, (x + y) % 4 ? STONE[2] : STONE[1]);
  // door
  for (let y = 26; y < 41; y++)
    for (let x = 19; x < 29; x++) {
      if (x === 19 || x === 28 || y === 26) b.set(x, y, WOOD[4]);
      else b.set(x, y, x === 22 || x === 25 ? WOOD[0] : WOOD[1]);
    }
  b.set(26, 34, '#e8b04a');
  b.set(26, 33, '#ffd880');
  for (let x = 18; x < 30; x++) {
    b.set(x, 43, STONE[3]);
    b.set(x, 44, STONE[2]);
  }
  // windows + flower boxes
  for (const x0 of [8, 32]) {
    for (let y = 24; y < 32; y++)
      for (let x = x0; x < x0 + 8; x++) {
        const edge = x === x0 || x === x0 + 7 || y === 24 || y === 31;
        const mull = x === x0 + 4 || y === 27;
        if (edge) b.set(x, y, y === 24 ? WOOD[5] : WOOD[4]);
        else if (mull) b.set(x, y, WOOD[3]);
        else b.set(x, y, [3, 4].includes(x - x0 + (y - 24)) ? '#7aa8c8' : '#2a4a6a');
      }
    for (let x = x0 - 1; x < x0 + 9; x++) {
      b.set(x, 33, WOOD[1]);
      b.set(x, 32, ['#ff6f91', '#3f8a32', '#ffd34a', '#3f8a32', '#ffffff'][mod(x - x0, 5)]);
    }
  }
  b.outline(OUTL);
  out.set('house-base', b);

  // lit windows overlay
  const lit = new Px(48, 46);
  for (const x0 of [8, 32]) {
    for (let y = 25; y < 31; y++)
      for (let x = x0 + 1; x < x0 + 7; x++)
        if (x !== x0 + 4 && y !== 27) lit.set(x, y, [3, 4].includes(x - x0 + (y - 24)) ? '#ffe9a8' : '#ffd06a');
    for (const [x, y] of ellipsePts(x0 + 4, 28, 6, 5)) if (lit.get(x, y) === null) lit.set(x, y, '#ffd06a', 0.18);
  }
  out.set('house-lit', lit);

  // roof
  const roof: Pt[] = [];
  for (let y = 2; y < 22; y++) {
    const hw = y < 19 ? Math.min(23.5, 5 + (y - 2) * 1.15) : 24;
    for (let x = 0; x < 48; x++) if (Math.abs(x + 0.5 - 24) <= hw) roof.push([x, y]);
  }
  const m = new Px(48, 46);
  for (const [x, y] of roof) m.set(x, y, '#000000');
  out.set('house-roof-mask', m);
  const d = new Px(48, 46);
  const edge = new Px(48, 46);
  for (const [x, y] of roof) edge.set(x, y, '#000000');
  edge.outline('#ff00ff');
  for (let y = 0; y < 46; y++) for (let x = 0; x < 48; x++) if (edge.get(x, y)?.[0] === '#ff00ff') d.set(x, y, OUTL);
  for (const [x, y] of roof) {
    const band = Math.floor((y - 2) / 3);
    if ((y - 2) % 3 === 2) d.set(x, y, '#000000', 0.3);
    else if ((x + band * 3) % 6 === 0) d.set(x, y, '#000000', 0.2);
    else if ((y - 2) % 3 === 0) d.set(x, y, '#ffffff', 0.14);
    if (y >= 20) d.set(x, y, '#000000', 0.42);
    if (y <= 3) d.set(x, y, '#ffffff', 0.3);
    if (x > 30 && y < 20 && d.get(x, y) === null) d.set(x, y, '#000000', 0.1);
  }
  out.set('house-roof-detail', d);
}

// ---------------- crab desk ----------------
function desk(on: boolean) {
  const d = new Px(26, 18);
  for (const [x, y] of ellipsePts(13, 16.5, 12, 1.5)) d.set(x, y, '#000000', 0.25);
  for (let y = 8; y < 11; y++) for (let x = 1; x < 25; x++) d.set(x, y, y === 8 ? WOOD[4] : WOOD[3]);
  for (let y = 11; y < 17; y++) for (const x of [3, 4, 21, 22]) d.set(x, y, x === 3 || x === 21 ? WOOD[2] : WOOD[1]);
  for (let x = 7; x < 18; x++) d.set(x, 7, '#8a8a92');
  for (let y = 0; y < 7; y++)
    for (let x = 8; x < 17; x++) {
      if (x === 8 || x === 16 || y === 0) d.set(x, y, '#4a4a56');
      else if (on) d.set(x, y, (y === 2 || y === 4) && x < 14 ? '#bff0ff' : '#5ac8ea');
      else d.set(x, y, '#2a2d3a');
    }
  for (const y of [5, 6, 7]) {
    d.set(20, y, '#f8f8f2');
    d.set(21, y, '#d6d6c8');
  }
  d.set(22, 6, '#d6d6c8');
  d.outline(OUTL);
  return d;
}

// ---------------- trees, bushes, rocks ----------------
const LEAF = ['#1f4a1a', '#2f6b2a', '#3f8a32', '#5aa83f', '#7cc04a', '#a6d96a'];

function oak() {
  const t = new Px(34, 44);
  for (const [x, y] of ellipsePts(17, 41.5, 12, 2)) t.set(x, y, '#000000', 0.28);
  const BARK = ['#3a2210', '#5a3518', '#7a4a24', '#9a6232'];
  for (let y = 24; y < 41; y++) {
    const w = y < 37 ? 3 : 4 + (y - 37);
    for (let x = 17 - w; x < 17 + w; x++) {
      let col = x < 16 ? BARK[2] : BARK[1];
      if (x === 15 || (x === 18 && y % 4 === 0)) col = BARK[0];
      if (x === 14 && y < 37) col = BARK[3];
      t.set(x, y, col);
    }
  }
  const r = rng(3);
  for (const [cx, cy, rad] of [
    [17, 14, 12],
    [8, 19, 7.5],
    [26, 19, 7.5],
    [12, 8, 7],
    [22, 8, 7],
    [17, 22, 8],
  ])
    for (const [x, y] of ellipsePts(cx, cy, rad, rad * 0.92)) {
      const light = ((cx - x) * 0.5 + (cy - y) * 0.8) / rad;
      t.set(x, y, rampPick(LEAF, 0.5 + light * 0.32 - (y / 44) * 0.35 + r.uniform(-0.08, 0.08)));
    }
  for (let i = 0; i < 26; i++) {
    const x = r.randint(4, 29);
    const y = r.randint(2, 24);
    if (t.solid(x, y) && LEAF.slice(3).includes(t.get(x, y)![0])) {
      t.set(x, y, LEAF[5]);
      t.set(x + 1, y, LEAF[4]);
    }
  }
  t.outline('#163a12');
  return t;
}

function pine() {
  const t = new Px(26, 46);
  for (const [x, y] of ellipsePts(13, 43.5, 9, 1.8)) t.set(x, y, '#000000', 0.28);
  for (let y = 34; y < 43; y++) for (let x = 11; x < 15; x++) t.set(x, y, x > 12 ? '#5a3518' : '#7a4a24');
  const PINE = ['#14361a', '#1f4a24', '#2a6230', '#3a7a3a', '#5a9a4a'];
  for (const [top, bot, hw] of [
    [2, 16, 6],
    [9, 26, 9],
    [17, 36, 11.5],
  ])
    for (let y = top; y < bot; y++) {
      const w = (hw * (y - top + 1)) / (bot - top);
      for (let x = 0; x < 26; x++) {
        const dx = x + 0.5 - 13;
        if (Math.abs(dx) > w) continue;
        let v = 0.6 - dx / 26 - ((y - top) / (bot - top)) * 0.3;
        if ((y - top) % 4 === 3 && Math.abs(dx) > w - 2) v -= 0.25;
        t.set(x, y, rampPick(PINE, v));
      }
    }
  t.outline('#0e2612');
  return t;
}

function bush(name: string, flowers: string[]) {
  const b = new Px(22, 15);
  for (const [x, y] of ellipsePts(11, 13.5, 10, 1.4)) b.set(x, y, '#000000', 0.25);
  const r = rng(name.length);
  for (const [cx, cy, rad] of [
    [6, 9, 5],
    [15, 9, 5.5],
    [10.5, 6, 5],
  ])
    for (const [x, y] of ellipsePts(cx, cy, rad, rad * 0.9)) {
      const v = 0.55 + (((cx - x) * 0.4 + (cy - y) * 0.8) / rad) * 0.3 + r.uniform(-0.07, 0.07);
      b.set(x, y, rampPick(LEAF, v));
    }
  for (let i = 0; i < 7; i++) {
    const x = r.randint(3, 18);
    const y = r.randint(3, 11);
    if (b.solid(x, y)) b.set(x, y, flowers[i % flowers.length]);
  }
  b.outline('#163a12');
  return b;
}

function rock() {
  const k = new Px(14, 10);
  for (const [x, y] of ellipsePts(7, 8.8, 6.5, 1.2)) k.set(x, y, '#000000', 0.25);
  for (const [x, y] of ellipsePts(7, 5.5, 6, 4)) k.set(x, y, rampPick(STONE, 0.85 - (y / 10) * 0.6 - (x / 14) * 0.2));
  k.set(4, 3, STONE[4]);
  k.outline('#2a2a26');
  return k;
}

function flowers() {
  const f = new Px(14, 9);
  for (const [x, y, c] of [
    [2, 3, '#ff6f91'],
    [6, 1, '#ffd34a'],
    [10, 3, '#ffffff'],
    [4, 5, '#ffffff'],
    [8, 5, '#ff6f91'],
    [12, 6, '#ffd34a'],
  ] as const) {
    f.set(x, y + 1, '#2f6b2a');
    f.set(x, y + 2, '#2f6b2a');
    f.set(x - 1, y, c);
    f.set(x + 1, y, c);
    f.set(x, y - 1, c);
    f.set(x, y, c !== '#ffd34a' ? '#ffe9a8' : '#e88a20');
  }
  return f;
}

// ---------------- ground tiles ----------------
function grass() {
  const g = new Px(32, 32);
  const r = rng(11);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const v = r.random();
      g.set(x, y, v < 0.62 ? '#5a9e3c' : v < 0.8 ? '#4f8f32' : v < 0.95 ? '#64aa44' : '#3f7a28');
    }
  for (let i = 0; i < 9; i++) {
    const x = r.randint(2, 29);
    const y = r.randint(3, 29);
    g.set(x, y, '#3f7a28');
    g.set(x - 1, y - 1, '#3f7a28');
    g.set(x + 1, y - 1, '#3f7a28');
    g.set(x, y - 1, '#7cc04a');
    g.set(x - 1, y - 2, '#7cc04a');
    g.set(x + 1, y - 2, '#8cc65a');
  }
  for (const c of ['#ffd34a', '#ffffff']) g.set(r.randint(2, 29), r.randint(2, 29), c);
  return g;
}

// Autotiles for the ground (see web/src/lib/village/tiles.ts): a 4 × 4 atlas of 16 × 16 tiles, tile i for corner
// mask i (bit 1 NW, 2 NE, 4 SW, 8 SE: the quadrants that are material). Each tile is worked out on a 48 × 48
// window round it, so the rounding and the edge rings see the neighbouring tiles' material. Outside the material
// stays transparent: the grass (or, for cobble, the dirt) shows through.
type Ground = {
  /** Fill of a material pixel at (x, y) of the 16-pixel repeat. */
  tex: (x: number, y: number) => string;
  /** Colour of a material pixel by its distance to the edge (1, 2, …); null keeps the fill. */
  ring: (d: number, up: boolean, x: number, y: number) => string | null;
  /** Colour and alpha just outside the edge: south of the material (shadow) or else. */
  lip: (south: boolean, x: number, y: number) => Pixel;
  /** Scattered pixels beyond the lip, d = 2 … 4 steps off the material: the edge fades out instead of cutting. */
  fringe?: (d: number, x: number, y: number) => Pixel;
};

/** 4 × 4 ordered-dither thresholds 0–15, for edges that fade out in a pattern. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

function autotiles(g: Ground) {
  const atlas = new Px(64, 64);
  const N = 48;
  const disk: Pt[] = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dy * dy <= 26) disk.push([dx, dy]);
  const morph = (m: boolean[][], all: boolean, raw: (x: number, y: number) => boolean) =>
    m.map((row, y) =>
      row.map((_, x) => {
        const at = ([dx, dy]: Pt) => m[y + dy]?.[x + dx] ?? raw(x + dx, y + dy);
        return all ? disk.every(at) : disk.some(at);
      }),
    );
  for (let mask = 1; mask < 16; mask++) {
    const raw = (x: number, y: number) => !!((mask >> (+(x >= N / 2) + 2 * +(y >= N / 2))) & 1);
    let m = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => raw(x, y)));
    // Closing rounds the inner corners, opening the outer ones.
    m = morph(morph(m, false, raw), true, raw);
    m = morph(morph(m, true, raw), false, raw);
    const on = (x: number, y: number) => m[y]?.[x] ?? raw(x, y);
    /** Steps to the nearest pixel off the material (up to 4). */
    const dist = (x: number, y: number) => {
      for (let d = 1; d < 4; d++)
        for (let k = -d; k <= d; k++)
          if (!on(x + k, y - d) || !on(x + k, y + d) || !on(x - d, y + k) || !on(x + d, y + k)) return d;
      return 4;
    };
    /** Steps to the nearest material pixel for a pixel outside it (2 to 4), else 0. */
    const out_ = (x: number, y: number) => {
      for (let d = 2; d <= 4; d++)
        for (let k = -d; k <= d; k++)
          if (on(x + k, y - d) || on(x + k, y + d) || on(x - d, y + k) || on(x + d, y + k)) return d;
      return 0;
    };
    const ox = (mask % 4) * 16;
    const oy = Math.floor(mask / 4) * 16;
    for (let y = 16; y < 32; y++)
      for (let x = 16; x < 32; x++) {
        const [tx, ty] = [x - 16, y - 16];
        if (on(x, y)) {
          const d = dist(x, y);
          const up = !on(x, y - d) || !on(x - d, y);
          const [gx, gy] = [mod(tx + 8, 16), mod(ty + 8, 16)];
          atlas.set(ox + tx, oy + ty, g.ring(d, up, gx, gy) ?? g.tex(gx, gy));
        } else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) {
          const px = g.lip(on(x, y - 1), mod(tx + 8, 16), mod(ty + 8, 16));
          if (px) atlas.set(ox + tx, oy + ty, ...px);
        } else if (g.fringe) {
          const d = out_(x, y);
          const px = d && g.fringe(d, mod(tx + 8, 16), mod(ty + 8, 16));
          if (px) atlas.set(ox + tx, oy + ty, ...px);
        }
      }
  }
  return atlas;
}

/** A 16 × 16 repeat of seeded noise from a palette of [colour, cumulative chance]. */
function noise(seed: number, pal: [string, number][]) {
  const r = rng(seed);
  return Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, () => {
      const v = r.random();
      return pal.find(([, p]) => v < p)![0];
    }),
  );
}

function dirtTiles() {
  const t = noise(5, [
    ['#b98a58', 0.6],
    ['#a87a4a', 0.82],
    ['#c99a64', 1],
  ]);
  const r = rng(6);
  for (let i = 0; i < 2; i++) {
    const [x, y] = [r.randint(1, 13), r.randint(1, 14)];
    t[y][x] = '#7a5a36';
    t[y][x + 1] = '#8a6a44';
    t[y - 1][x] = '#d8b484';
  }
  return autotiles({
    tex: (x, y) => t[y][x],
    // The rim: now and then a grass blade over the edge, else a dark line; a shadow under the grass above.
    ring: (d, up, x, y) =>
      d === 1
        ? (x * 5 + y * 3) % 7 === 0
          ? '#4f8f32'
          : bayer(x, y) < 9
            ? '#5a3c22'
            : '#7a5634'
        : d === 2
          ? up
            ? '#8a6040'
            : '#9e7046'
          : d === 3 && up
            ? '#a87a4a'
            : null,
    lip: (_s, x, y) => [(x * 5 + y * 3) % 7 === 0 ? '#7cc04a' : bayer(x, y) < 8 ? '#3a7024' : '#46822c', 1],
    // Dirt crumbs thrown over the grass, thinning out.
    fringe: (d, x, y) =>
      bayer(x, y) < (d === 2 ? 5 : d === 3 ? 2 : 1) ? [(x + y) % 3 ? '#a87a4a' : '#b98a58', 1] : null,
  });
}

function cobbleTiles() {
  const t = Array.from({ length: 16 }, () => Array<string>(16).fill('#5e584c'));
  for (const [x0, y0, x1, y1] of [
    [1, 1, 7, 6],
    [9, 1, 14, 5],
    [1, 8, 5, 14],
    [7, 7, 14, 14],
  ])
    for (const [x, y] of rrectPts(x0, y0, x1, y1, 2)) {
      const v = 0.8 - ((y - y0) / (y1 - y0 + 1)) * 0.5;
      t[y][x] = rampPick(['#8a8478', '#a8a294', '#c4bcaa', '#d8d0bc'], v);
    }
  return autotiles({
    tex: (x, y) => t[y][x],
    // A curb: dark outline, a light kerb stone, its shadow.
    ring: (d, up, x, y) =>
      d === 1
        ? bayer(x, y) < 11
          ? '#34302a'
          : '#5e584c'
        : d === 2
          ? up
            ? '#d8d0bc'
            : '#b4ad9c'
          : d === 3
            ? '#7a7468'
            : null,
    lip: (south) => (south ? ['#000000', 0.3] : null),
    // Loose stones strewn over the dirt beyond the curb, fewer the further out.
    fringe: (d, x, y) =>
      bayer(x * 3 + y, y * 3 + x) < (d === 2 ? 4 : d === 3 ? 2 : 1)
        ? [(x * 7 + y) % 3 ? '#8a8478' : '#a8a294', 1]
        : null,
  });
}

function fenceH() {
  const f = new Px(16, 14);
  for (let y = 1; y < 14; y++) for (let x = 1; x < 4; x++) f.set(x, y, x === 1 ? WOOD[4] : x === 2 ? WOOD[3] : WOOD[2]);
  f.set(2, 0, WOOD[4]);
  for (const y of [4, 5, 9, 10])
    for (let x = 0; x < 16; x++) if (x < 1 || x > 3) f.set(x, y, y === 4 || y === 9 ? WOOD[4] : WOOD[2]);
  for (const y of [6, 11]) for (let x = 0; x < 16; x++) if (x < 1 || x > 3) f.set(x, y, OUTL);
  for (let y = 1; y < 14; y++) {
    f.set(0, y, OUTL);
    f.set(4, y, OUTL);
  }
  f.set(1, 0, OUTL);
  f.set(3, 0, OUTL);
  return f;
}

function fenceV() {
  const v = new Px(6, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 1; x < 5; x++) v.set(x, y, x === 1 ? WOOD[4] : x < 4 ? WOOD[3] : WOOD[2]);
    v.set(0, y, OUTL);
    v.set(5, y, OUTL);
  }
  for (let x = 0; x < 6; x++) {
    v.set(x, 0, OUTL);
    v.set(x, 1, x >= 1 && x <= 4 ? WOOD[5] : OUTL);
  }
  return v;
}

// A gate post: a stout log with a cap, 8 × 20; two of them frame the gap in a district's fence.
function gatepost() {
  const g = new Px(8, 20);
  for (const [x, y] of ellipsePts(4, 18.5, 4, 1.5)) g.set(x, y, '#000000', 0.25);
  for (let y = 2; y < 19; y++)
    for (let x = 1; x < 7; x++) g.set(x, y, x === 1 ? WOOD[4] : x < 4 ? WOOD[3] : x < 6 ? WOOD[2] : WOOD[1]);
  for (let y = 7; y < 19; y += 5) for (let x = 2; x < 6; x++) g.set(x, y, WOOD[1]);
  for (let x = 0; x < 8; x++) g.set(x, 1, x === 0 || x === 7 ? OUTL : WOOD[5]);
  for (let x = 1; x < 7; x++) g.set(x, 0, OUTL);
  g.outline(OUTL);
  return g;
}

// ---------------- pond ----------------
function pond() {
  const p = new Px(140, 96);
  const W = ['#1a4a78', '#1f5a8a', '#2a72a8', '#3f8fc0', '#5aa8d8'];
  const SAND = ['#8a6a3a', '#b8945a', '#d4b47a', '#e8cf9a'];
  for (const [x, y] of ellipsePts(70, 48, 69, 46)) {
    const d = Math.hypot((x + 0.5 - 70) / 69, (y + 0.5 - 48) / 46);
    p.set(x, y, rampPick(SAND, 0.95 - d * 0.6 + ((x + y) % 3 === 0 ? 0.1 : 0)));
  }
  for (const [x, y] of ellipsePts(70, 47, 62, 39)) {
    const d = Math.hypot((x + 0.5 - 70) / 62, (y + 0.5 - 47) / 39);
    p.set(x, y, rampPick(W, 0.95 - d * 0.75 - (y / 96) * 0.15));
  }
  const r = rng(9);
  for (let i = 0; i < 14; i++) {
    const x = r.randint(25, 110);
    const y = r.randint(22, 70);
    const here = p.get(x, y);
    if (here && W.includes(here[0])) {
      const n = r.randint(3, 6);
      for (let j = 0; j < n; j++) p.set(x + j, y, '#8ccbec');
      p.set(x + 1, y - 1, '#bfe4f6');
    }
  }
  for (const [cx, cy, rad, fl] of [
    [40, 34, 5, true],
    [96, 58, 6, false],
    [58, 64, 4, false],
    [104, 30, 4.5, true],
  ] as const) {
    for (const [x, y] of ellipsePts(cx, cy, rad, rad * 0.7))
      if (!(x > cx && y === cy)) p.set(x, y, y < cy ? '#4f9a35' : '#3f7a28');
    if (fl) {
      p.set(cx - 1, cy - 1, '#ff9ec7');
      p.set(cx, cy - 2, '#ff9ec7');
      p.set(cx + 1, cy - 1, '#ff9ec7');
      p.set(cx, cy - 1, '#ffd34a');
    }
  }
  for (const cx of [12, 18, 122, 128, 24]) {
    const top = r.randint(26, 40);
    const base = 48 + r.randint(-6, 10);
    for (let y = top; y < base; y++) {
      p.set(cx, y, y > top + 2 ? '#2f6b2a' : '#7a4a24');
      p.set(cx + 1, y, y > top + 2 ? '#3f8a32' : '#9a6232');
    }
  }
  for (const [cx, cy] of [
    [30, 84],
    [112, 82],
    [8, 60],
  ])
    for (const [x, y] of ellipsePts(cx, cy, 4, 3)) p.set(x, y, rampPick(STONE, 0.8 - ((y - cy + 3) / 6) * 0.5));
  return p;
}

// ---------------- you at your desk ----------------
function you(frame: number) {
  const c = new Px(56, 46);
  for (const [x, y] of ellipsePts(28, 44, 27, 2)) c.set(x, y, '#000000', 0.28);
  // chair back
  for (const [x, y] of rrectPts(17, 6, 38, 30, 4)) c.set(x, y, x < 33 ? '#3a3248' : '#2a2436');
  const SKIN = ['#b8845a', '#d8a47a', '#f0c8a0', '#fbe0c0'];
  const HAIR = ['#2a160c', '#4a2a1a', '#6a3e24'];
  const HOOD = ['#5a3aa0', '#7a52c8', '#9a72e8', '#b89af8'];
  for (const [x, y] of rrectPts(18, 19, 37, 30, 4)) c.set(x, y, rampPick(HOOD, 0.8 - ((x - 18) / 20) * 0.5));
  for (let y = 20; y < 26; y++) {
    c.set(26, y, '#f8f8f2');
    c.set(30, y, '#f8f8f2');
  }
  for (const [x, y] of rrectPts(22, 6, 33, 18, 4)) c.set(x, y, rampPick(SKIN, 0.85 - ((x - 22) / 12) * 0.4));
  for (const [x, y] of rrectPts(21, 3, 34, 9, 4)) c.set(x, y, rampPick(HAIR, 0.9 - ((y - 3) / 7) * 0.6));
  for (let x = 22; x < 34; x++) if (x % 3 !== 0) c.set(x, 10, HAIR[1]);
  for (const x of [21, 34]) for (let y = 8; y < 13; y++) c.set(x, y, HAIR[0]);
  for (let x = 20; x < 36; x++) c.set(x, x >= 23 && x <= 32 ? 3 : 4, '#ae81ff');
  for (const [x, y] of [...rrectPts(18, 9, 21, 14, 1), ...rrectPts(34, 9, 37, 14, 1)]) c.set(x, y, '#8a5ad8');
  for (const [x, y] of [
    [24, 12],
    [24, 13],
    [31, 12],
    [31, 13],
  ])
    c.set(x, y, '#2a1410');
  c.set(27, 16, '#a8584a');
  c.set(28, 16, '#a8584a');
  c.set(23, 15, '#f08a8a');
  c.set(32, 15, '#f08a8a');
  // desk
  for (let y = 29; y < 33; y++) for (let x = 0; x < 56; x++) c.set(x, y, y === 29 ? WOOD[5] : WOOD[4]);
  for (let y = 33; y < 43; y++)
    for (let x = 2; x < 54; x++) c.set(x, y, y === 37 || x === 27 || x === 28 ? WOOD[1] : x < 40 ? WOOD[2] : WOOD[1]);
  c.set(20, 35, '#e8b04a');
  c.set(35, 35, '#e8b04a');
  // keyboard + hands
  for (let x = 20; x < 36; x++) {
    c.set(x, 28, '#4a4a56');
    c.set(x, 27, x % 2 ? '#8a8a92' : '#6a6a74');
  }
  const [hl, hr] = frame === 0 ? [26, 27] : [27, 26];
  c.set(21, hl, SKIN[2]);
  c.set(22, hl, SKIN[2]);
  c.set(33, hr, SKIN[2]);
  c.set(34, hr, SKIN[2]);
  // monitor on the right
  for (let y = 12; y < 27; y++)
    for (let x = 40; x < 54; x++) {
      if (x === 40 || x === 53 || y === 12 || y === 26) c.set(x, y, '#3a3a46');
      else c.set(x, y, mod(y - 13, 3) === 0 && x < 50 ? '#c8a8ff' : '#8a62e8');
    }
  for (const x of [45, 46, 47, 48]) {
    c.set(x, 27, '#3a3a46');
    c.set(x, 28, '#3a3a46');
  }
  // mug
  for (const y of [25, 26, 27, 28]) {
    c.set(7, y, '#f8f8f2');
    c.set(8, y, '#f8f8f2');
    c.set(9, y, '#d6d6c8');
  }
  c.set(10, 26, '#d6d6c8');
  c.set(10, 27, '#d6d6c8');
  c.set(8, 24, '#ffffff', 0.5);
  c.outline(OUTL);
  return c;
}

// ---------------- ambient life ----------------
function butterfly(wing: string, wing2: string, frame: number) {
  const b = new Px(9, 7);
  const open: Pt[] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [1, 3],
    [2, 3],
    [1, 4],
    [2, 4],
  ];
  const closed: Pt[] = [
    [2, 0],
    [3, 0],
    [2, 1],
    [3, 1],
    [2, 2],
    [3, 2],
    [3, 3],
  ];
  for (const [x, y] of frame === 0 ? open : closed) {
    const col = frame === 0 && y >= 3 ? wing2 : wing;
    b.set(x, y, col);
    b.set(8 - x, y, col);
  }
  for (let y = 1; y < 5; y++) b.set(4, y, '#2a1408');
  b.set(3, 0, '#2a1408');
  b.set(5, 0, '#2a1408');
  return b;
}

function bird(frame: number) {
  const b = new Px(11, 6);
  const ys = frame === 0 ? [0, 1, 2, 3, 3, 4, 3, 3, 2, 1, 0] : [4, 3, 3, 3, 3, 4, 3, 3, 3, 3, 4];
  ys.forEach((y, x) => b.set(x, y, '#3a3248'));
  b.set(5, 5, '#3a3248');
  return b;
}

function duck(frame: number) {
  const d = new Px(14, 11);
  for (const [x, y] of ellipsePts(7, 7, 5.5, 2.8)) d.set(x, y, y < 7 ? '#f8f8f2' : '#d6d6c8');
  for (const [x, y] of ellipsePts(10.5, 3.5, 2.2, 2.2)) d.set(x, y, x < 11 ? '#3f8a32' : '#2f6b2a');
  d.set(10, 3, '#14200e');
  d.set(13, 4, '#ff9a3c');
  d.set(13, 5, '#e8822a');
  for (let x = 3; x < 8; x++) d.set(x, 6, '#c9c0b0');
  d.set(2, 5, '#f8f8f2');
  d.set(1, 4, '#f8f8f2');
  d.outline('#2a2a26');
  for (let x = 1 + frame; x < 13 - frame; x += 2) d.set(x, frame === 0 ? 10 : 9, '#bfe4f6', 0.8);
  return d;
}

function mushroom() {
  const m = new Px(10, 10);
  for (const [x, y] of ellipsePts(5, 4, 4.5, 3.2)) if (y <= 4) m.set(x, y, x < 6 ? '#d83a3a' : '#b02a2a');
  for (const [x, y] of [
    [3, 2],
    [6, 1],
    [5, 3],
    [2, 4],
  ])
    m.set(x, y, '#ffffff');
  for (let y = 5; y < 9; y++) {
    m.set(4, y, '#f3e6cc');
    m.set(5, y, '#d8c8a8');
  }
  m.outline('#2a1408');
  return m;
}

function tallgrass() {
  const g = new Px(14, 11);
  const r = rng(4);
  const ramp = ['#2f6b2a', '#3f8a32', '#5aa83f', '#7cc04a'];
  for (let bx = 1; bx < 13; bx += 2) {
    const h = r.randint(5, 9);
    const lean = r.choice([-1, 0, 1]);
    for (let i = 0; i < h; i++)
      g.set(bx + (i > h * 0.6 ? lean : 0), 10 - i, ramp[Math.min(3, Math.floor((i * 4) / h))]);
  }
  return g;
}

function stump() {
  const s = new Px(16, 11);
  for (const [x, y] of ellipsePts(8, 9.8, 7.5, 1.2)) s.set(x, y, '#000000', 0.25);
  for (let y = 4; y < 10; y++) for (let x = 2; x < 14; x++) s.set(x, y, x > 4 ? '#7a4a24' : '#9a6232');
  for (const [x, y] of ellipsePts(8, 4, 6, 2.3)) s.set(x, y, '#d8b484');
  for (const [x, y] of ellipsePts(8, 4, 3.5, 1.2)) s.set(x, y, '#b8945a');
  s.set(8, 4, '#8a6a3a');
  s.outline('#2a1408');
  return s;
}

function sunflower() {
  const f = new Px(11, 20);
  for (let y = 7; y < 19; y++) f.set(5, y, '#3f8a32');
  for (const [x, y] of [
    [3, 11],
    [4, 11],
    [2, 10],
    [7, 13],
    [6, 13],
    [8, 12],
  ])
    f.set(x, y, '#5aa83f');
  for (const [x, y] of ellipsePts(5.5, 4.5, 4.5, 4.5)) f.set(x, y, (x + y) % 2 ? '#ffd34a' : '#f3b52a');
  for (const [x, y] of ellipsePts(5.5, 4.5, 2, 2)) f.set(x, y, '#6a3e1c');
  f.set(5, 3, '#8a5428');
  f.outline('#2a1408');
  return f;
}

function lounger() {
  const l = new Px(34, 15);
  for (const [x, y] of ellipsePts(17, 13.8, 16, 1.2)) l.set(x, y, '#000000', 0.25);
  const F = ['#f8f8f2', '#3f8fc0'];
  for (let y = 7; y < 10; y++)
    for (let x = 9; x < 32; x++) {
      const stripe = Math.floor(x / 2) % 2;
      l.set(x, y, y < 9 ? F[stripe] : stripe === 0 ? '#d6d6c8' : '#2a72a8');
    }
  for (let y = 1; y < 9; y++) {
    const x0 = 2 + Math.trunc((y - 1) * 0.9);
    for (let x = x0; x < x0 + 4; x++) l.set(x, y, F[Math.floor(y / 2) % 2]);
  }
  for (let x = 6; x < 33; x++) l.set(x, 10, WOOD[3]);
  for (const [x, y] of [
    [7, 11],
    [7, 12],
    [8, 13],
    [29, 11],
    [29, 12],
    [30, 13],
    [12, 11],
    [26, 11],
  ])
    l.set(x, y, WOOD[2]);
  for (let y = 4; y < 10; y++) l.set(1 + Math.trunc((y - 1) * 0.9), y, WOOD[2]);
  l.outline('#2a1408');
  return l;
}

// ---------------- context, worktrees, mayor, docker, night ----------------
function backpack(size: number) {
  const w = 10 + 2 * size;
  const h = 11 + 2 * size + (size === 2 ? 3 : 0);
  const b = new Px(w, h);
  const top = size === 2 ? 3 : 0;
  const OL = ['#3a4a1a', '#5a6a2a', '#7a8a3a', '#9aaa4a'];
  if (size === 2) {
    for (let y = 0; y < 5; y++) {
      b.set(w - 5, y, '#f3e6cc');
      b.set(w - 4, y, '#d8c8a8');
    }
    for (const y of [1, 2, 3]) b.set(3, y, '#e8b04a');
    b.set(3, 0, '#f8f8f2');
  }
  for (const [x, y] of rrectPts(0, top + 1, w - 1, h - 1, 2))
    b.set(x, y, rampPick(OL, 0.85 - ((y - top) / h) * 0.5 - (x > w - 4 ? 0.2 : 0)));
  for (let x = 1; x < w - 1; x++) {
    b.set(x, top + 3, OL[0]);
    b.set(x, top + 2, x < Math.floor(w / 2) ? OL[3] : OL[2]);
  }
  b.set(Math.floor(w / 2), top + 4, '#e8b04a');
  for (let y = top + 5; y < h - 2; y += 2) b.set(1, y, OL[0]);
  b.outline('#2a1408');
  return b;
}

function tent() {
  const t = new Px(28, 22);
  for (const [x, y] of ellipsePts(14, 20.5, 13, 1.4)) t.set(x, y, '#000000', 0.25);
  const C = ['#8a6a3a', '#b8945a', '#d8b884', '#eed8a8'];
  for (let y = 3; y < 20; y++) {
    const hw = (y - 2) * 0.78;
    for (let x = 0; x < 28; x++) {
      const dx = x + 0.5 - 14;
      if (Math.abs(dx) <= hw) t.set(x, y, Math.abs(dx) > 0.6 ? rampPick(C, dx < 0 ? 0.8 : 0.35) : C[0]);
    }
  }
  for (let y = 12; y < 20; y++) {
    const hw = (y - 11) * 0.55;
    for (let x = 0; x < 28; x++) if (Math.abs(x + 0.5 - 14) <= hw) t.set(x, y, '#3a2410');
  }
  for (let y = 0; y < 4; y++) t.set(14, y, '#5a3518');
  t.set(2, 19, '#5a3518');
  t.set(25, 19, '#5a3518');
  t.outline('#2a1408');
  return t;
}

function tophat() {
  const d = new Px(26, 26);
  for (let y = 0; y < 8; y++) {
    for (let x = 8; x < 18; x++) d.set(x, y, x < 16 ? '#2a2a36' : '#1a1a24');
    d.set(9, y, '#4a4a5a');
  }
  for (let x = 8; x < 18; x++) {
    d.set(x, 6, '#e8b04a');
    d.set(x, 7, '#c48a2a');
  }
  for (let x = 5; x < 21; x++) {
    d.set(x, 8, '#2a2a36');
    d.set(x, 9, '#1a1a24');
  }
  d.outline('#08080c');
  return d;
}

function townhall() {
  const h = new Px(66, 62);
  for (const [x, y] of ellipsePts(33, 59.5, 32, 2.2)) h.set(x, y, '#000000', 0.28);
  const ST = ['#8a8274', '#a8a092', '#c4bcaa', '#d8d0bc', '#e8e2d0'];
  for (let y = 22; y < 54; y++)
    for (let x = 5; x < 61; x++) {
      const seam = (y - 22) % 5 === 4 || (x + Math.floor((y - 22) / 5) * 4) % 9 === 0;
      h.set(x, y, seam ? ST[1] : rampPick(ST, 0.75 - (x > 48 ? 0.25 : 0)));
    }
  for (const x0 of [11, 21, 41, 51]) {
    for (let y = 24; y < 52; y++)
      for (let x = x0; x < x0 + 4; x++) h.set(x, y, ['#ffffff', '#f3efe6', '#d8d2c4', '#b8b2a4'][x - x0]);
    for (let x = x0 - 1; x < x0 + 5; x++) {
      h.set(x, 23, '#f3efe6');
      h.set(x, 52, '#d8d2c4');
    }
  }
  for (const x0 of [15, 45])
    for (let y = 30; y < 38; y++)
      for (let x = x0 + 1; x < x0 + 5; x++) h.set(x, y, (x + y) % 5 ? '#2a4a6a' : '#7aa8c8');
  for (let y = 34; y < 52; y++)
    for (let x = 27; x < 39; x++) {
      const arch = y < 37 && Math.abs(x + 0.5 - 33) > (y - 33) * 2;
      if (!arch) h.set(x, y, x === 32 || x === 33 ? '#3a2410' : '#5a3518');
    }
  h.set(35, 44, '#e8b04a');
  const R = ['#1f3f78', '#2a52a0', '#3f6fb0', '#5a8ad0'];
  for (let y = 6; y < 22; y++) {
    const hw = (y - 5) * 1.95;
    for (let x = 0; x < 66; x++) {
      const dx = x + 0.5 - 33;
      if (Math.abs(dx) <= hw) h.set(x, y, rampPick(R, 0.85 - ((y - 6) / 16) * 0.5 - (dx > 0 ? 0.2 : 0)));
    }
  }
  for (let x = 1; x < 65; x++) h.set(x, 21, R[0]);
  for (const [x, y] of ellipsePts(33, 14.5, 4.2, 4.2)) h.set(x, y, '#f8f8f2');
  for (const [x, y] of [
    [33, 12],
    [33, 13],
    [33, 14],
    [34, 14],
    [35, 14],
  ])
    h.set(x, y, '#2a1408');
  for (let y = 0; y < 7; y++) h.set(33, y, '#5a5a5a');
  for (let y = 0; y < 4; y++) for (let x = 34; x < 41; x++) h.set(x, y, (x + y) % 3 ? '#f92672' : '#ff6f9a');
  for (let y = 54; y < 58; y++) for (let x = 4 + (y - 54); x < 62 - (y - 54); x++) h.set(x, y, y % 2 ? ST[3] : ST[2]);
  h.outline('#2a1408');
  return h;
}

function machine(up: boolean) {
  const m = new Px(18, 18);
  for (const [x, y] of ellipsePts(9, 16.6, 8, 1.2)) m.set(x, y, '#000000', 0.25);
  const MT = ['#4a5058', '#6a7480', '#8a96a4', '#aab6c4'];
  for (let y = 5; y < 16; y++)
    for (let x = 1; x < 16; x++) m.set(x, y, rampPick(MT, 0.8 - ((y - 5) / 11) * 0.4 - (x > 12 ? 0.25 : 0)));
  for (let x = 1; x < 16; x++) m.set(x, 5, MT[3]);
  for (let y = 0; y < 5; y++) for (const x of [11, 12]) m.set(x + (!up && y < 2 ? 1 : 0), y, x === 12 ? MT[1] : MT[2]);
  for (const [x, y] of ellipsePts(5.5, 10, 2.6, 2.6)) m.set(x, y, up ? '#f8f8f2' : '#9a9a9a');
  m.set(5, 10, '#2a1408');
  m.set(up ? 6 : 4, up ? 9 : 11, '#2a1408');
  const light = up ? '#5ad84a' : '#e84a3a';
  for (const [x, y] of [
    [12, 8],
    [13, 8],
    [12, 9],
    [13, 9],
  ])
    m.set(x, y, light);
  for (let x = 10; x < 15; x++) {
    m.set(x, 12, MT[0]);
    m.set(x, 14, MT[0]);
  }
  if (!up)
    for (const [x, y] of [
      [3, 6],
      [4, 7],
      [3, 8],
      [8, 13],
      [9, 14],
    ])
      m.set(x, y, '#2a1408');
  m.outline('#1a1408');
  return m;
}

function lantern() {
  const l = new Px(9, 24);
  for (const [x, y] of ellipsePts(4.5, 22.8, 4, 1)) l.set(x, y, '#000000', 0.25);
  for (let y = 7; y < 22; y++) {
    l.set(4, y, '#3a3a46');
    l.set(5, y, '#24242e');
  }
  for (let x = 2; x < 8; x++) l.set(x, 21, '#3a3a46');
  for (let y = 1; y < 7; y++)
    for (let x = 1; x < 8; x++) {
      const edge = x === 1 || x === 7 || y === 1 || y === 6;
      l.set(x, y, edge ? '#24242e' : x < 5 ? '#ffe9a8' : '#ffd06a');
    }
  for (let x = 2; x < 7; x++) l.set(x, 0, '#24242e');
  l.outline('#0a0a10');
  return l;
}

function boards() {
  const b = new Px(48, 46);
  const P = ['#6a4a2a', '#8a6a42', '#a8865a'];
  const plank = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = pyRound(x0 + ((x1 - x0) * i) / n);
      const y = pyRound(y0 + ((y1 - y0) * i) / n);
      b.set(x, y, P[2]);
      b.set(x, y + 1, P[1]);
      b.set(x, y + 2, P[0]);
    }
  };
  plank(19, 28, 28, 38);
  plank(19, 38, 28, 28);
  for (const x0 of [8, 32]) {
    plank(x0 - 1, 25, x0 + 8, 25);
    plank(x0 - 1, 29, x0 + 8, 29);
  }
  b.outline('#2a1408');
  return b;
}

/** All sprites by file name (without .svg). */
export function sprites(): Map<string, Px> {
  const out = new Map<string, Px>();
  for (const [pose, frame] of [
    ['idle', 0],
    ['blink', 0],
    ['walk', 0],
    ['walk', 1],
    ['work', 0],
    ['work', 1],
    ['sleep', 0],
  ] as const)
    out.set(`crab-${pose}${frame}`, crab(pose, frame));
  hats(out);
  house(out);
  out.set('desk-on', desk(true));
  out.set('desk-off', desk(false));
  out.set('tree-oak', oak());
  out.set('tree-pine', pine());
  out.set('bush-pink', bush('bush-pink', ['#ff9ec7', '#ffffff', '#ff6f91']));
  out.set('bush-yellow', bush('bush-yellow', ['#ffd34a', '#ffffff']));
  out.set('rock', rock());
  out.set('flowers', flowers());
  out.set('tile-grass', grass());
  out.set('tiles-dirt', dirtTiles());
  out.set('tiles-cobble', cobbleTiles());
  out.set('fence-h', fenceH());
  out.set('fence-v', fenceV());
  out.set('gatepost', gatepost());
  out.set('pond', pond());
  out.set('you-0', you(0));
  out.set('you-1', you(1));
  for (const f of [0, 1]) {
    out.set(`fly-orange${f}`, butterfly('#ff9a3c', '#ffd34a', f));
    out.set(`fly-blue${f}`, butterfly('#8cd0ff', '#ffffff', f));
    out.set(`bird${f}`, bird(f));
    out.set(`duck${f}`, duck(f));
  }
  out.set('mushroom', mushroom());
  out.set('tallgrass', tallgrass());
  out.set('stump', stump());
  out.set('sunflower', sunflower());
  out.set('lounger', lounger());
  for (const s of [0, 1, 2]) out.set(`pack${s}`, backpack(s));
  out.set('tent', tent());
  out.set('hat-mayor', tophat());
  out.set('townhall', townhall());
  out.set('machine-up', machine(true));
  out.set('machine-down', machine(false));
  out.set('lantern', lantern());
  out.set('boards', boards());
  return out;
}

export function writeSprites(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [name, px] of sprites()) writeFileSync(join(dir, `${name}.svg`), px.svg() + '\n');
}

// import.meta.main is false for .ts entry files in Node 24.2.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../../web/public/village/', import.meta.url));
  writeSprites(dir);
  console.log(`wrote ${sprites().size} sprites to ${dir}`);
}
