// Your character on foot: a point (the feet) that moves with 8-way input at a fixed speed and slides along whatever
// blocks it. Pure: the view feeds it the held keys and the elapsed time. What blocks is `blocked`: the sprites the
// crabs also go round (path.ts `blockers`: houses, workbenches, the hall, your desk), the forest and the water, the
// pond, the fences of the districts except their gates, and the edge of the map.
import { blockers } from './path.ts';
import { FOREST, groundAt, TILE, WATER } from './tiles.ts';
import { inRect, SIZES, type Point, type Rect, type World } from './world.ts';

/** Map px per second. */
export const SPEED = 140;
/** Feet half-width and height: a walker is a small box, not a point, so it does not poke into walls. */
const HALF = 6;
const DEPTH = 6;
/** The fence sprite is about 28 px thick; half of it, narrowed, blocks. */
const FENCE = 8;
/** One physics sub-step at most, so a lagging frame cannot jump over a fence. */
const MAX_STEP = 6;

const solid = new WeakMap<World, Rect[]>();
const solidOf = (w: World): Rect[] => {
  let s = solid.get(w);
  if (!s) {
    const edge = (x: number, y: number, bw: number, bh: number): Rect => ({ x, y, w: bw, h: bh });
    // Fences are bands round every district, the gate side cut open between the gate posts.
    s = [...blockers(w)];
    for (const d of w.districts) {
      const [gx, gy] = d.gate;
      const gap = TILE - 4;
      s.push(
        edge(d.x - FENCE, d.y - FENCE, FENCE * 2, d.h + FENCE * 2),
        edge(d.x + d.w - FENCE, d.y - FENCE, FENCE * 2, d.h + FENCE * 2),
      );
      for (const y of [d.y, d.y + d.h]) {
        if (y !== gy) s.push(edge(d.x - FENCE, y - FENCE, d.w + FENCE * 2, FENCE * 2));
        else {
          s.push(edge(d.x - FENCE, y - FENCE, gx - gap - d.x + FENCE, FENCE * 2));
          s.push(edge(gx + gap, y - FENCE, d.x + d.w + FENCE - gx - gap, FENCE * 2));
        }
      }
    }
    solid.set(w, s);
  }
  return s;
};

/** Is this feet position inside something solid? The one test for where you can not stand. */
export function blocked(w: World, x: number, y: number): boolean {
  const probes: Point[] = [
    [x - HALF, y],
    [x + HALF, y],
    [x - HALF, y - DEPTH],
    [x + HALF, y - DEPTH],
  ];
  const pond = SIZES.pond;
  return probes.some(([px, py]) => {
    if (px < 0 || py < 0 || px >= w.W || py >= w.H) return true;
    const m = groundAt(w.ground, px, py);
    if (m === FOREST || m === WATER) return true;
    if (((px - w.pond.x) / (pond[0] / 2 - 10)) ** 2 + ((py - w.pond.y) / (pond[1] / 2 - 10)) ** 2 < 1) return true;
    return solidOf(w).some((r) => inRect(px, py, r));
  });
}

/** Where you stand up: just below your desk, on open ground. */
export const standSpot = (w: World): Point => [w.you.x, w.you.y + 28];

/** Unit direction for the held keys (diagonals are normalised, so they are no faster). */
export function direction(left: boolean, right: boolean, up: boolean, down: boolean): Point {
  const dx = +right - +left;
  const dy = +down - +up;
  const n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
}

/**
 * Walk `dist` px along the unit direction (vx, vy) from (x, y). A blocked move slides along the wall (first with
 * the x part alone, then the y part). Returns the new spot and how far it got.
 */
export function advance(w: World, x: number, y: number, vx: number, vy: number, dist: number) {
  let [cx, cy, moved] = [x, y, 0];
  for (let left = dist; left > 1e-6;) {
    const s = Math.min(MAX_STEP, left);
    left -= s;
    const [nx, ny] = [cx + vx * s, cy + vy * s];
    if (!blocked(w, nx, ny)) [cx, cy, moved] = [nx, ny, moved + s];
    else if (vx && !blocked(w, nx, cy)) [cx, moved] = [nx, moved + Math.abs(vx) * s];
    else if (vy && !blocked(w, cx, ny)) [cy, moved] = [ny, moved + Math.abs(vy) * s];
  }
  return { x: cx, y: cy, moved };
}

/** How near (map px, from your feet) a crab must be for E to talk to it; the desk is a wide thing, so it gets more. */
export const REACH = 64;
export const DESK_REACH = 96;

export type Target = { kind: 'crab'; id: string } | { kind: 'desk' } | null;

/** What E does from where you stand: the nearest crab within reach, or your desk if that is nearer (or no crab is). */
export function inReach(w: World, me: { x: number; y: number }, crabs: { id: string; x: number; y: number }[]): Target {
  let best: Target = null;
  let bd = Infinity;
  for (const c of crabs) {
    const d = Math.hypot(c.x - me.x, c.y - me.y);
    if (d <= REACH && d < bd) [best, bd] = [{ kind: 'crab', id: c.id }, d];
  }
  const desk = Math.hypot(w.you.x - me.x, w.you.y - 8 - me.y);
  return desk <= DESK_REACH && desk < bd ? { kind: 'desk' } : best;
}
