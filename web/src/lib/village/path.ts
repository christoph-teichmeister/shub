// Crab pathfinding: A* on the tile grid of the ground (tiles.ts). Walkable are the path tiles (road, lane, plaza) and the
// inside of every district (grass between the houses); a district is entered and left only through its gate, and the
// grass outside the districts is off limits. Houses, workbenches, the town hall and your desk are blocked.
// The route is the list of tile centres, ending at the exact target.
import { cellAt, isPath, TILE } from './tiles.ts';
import type { Point, Rect, World } from './world.ts';

interface Mask {
  cols: number;
  rows: number;
  /** Walkable cells. */
  ok: Uint8Array;
  /** District index per cell, -1 outside. */
  zone: Int16Array;
  /** The cells either side of a gate: the only ones where the zone may change. */
  gate: Uint8Array;
}

/** What blocks crabs: sprites on the ground. Your desk gets a tile of room, so nobody cuts across its front. */
export function blockers(w: World): Rect[] {
  const box = (x: number, y: number, bw: number, bh: number, m = 0): Rect => ({
    x: x - bw / 2 - m,
    y: y - bh - m,
    w: bw + 2 * m,
    h: bh + 2 * m,
  });
  return [
    ...Object.values(w.houses).flatMap((h) => [box(h.x, h.y, 96, 92), box(h.desk.x, h.desk.y, 52, 36)]),
    box(w.hall.x, w.hall.y, 132, 124),
    box(w.you.x, w.you.y, 112, 92, TILE / 2),
  ];
}

const masks = new WeakMap<World, Mask>();

function maskOf(w: World): Mask {
  let m = masks.get(w);
  if (m) return m;
  const { cols, rows } = w.ground;
  m = {
    cols,
    rows,
    ok: new Uint8Array(cols * rows),
    zone: new Int16Array(cols * rows).fill(-1),
    gate: new Uint8Array(cols * rows),
  };
  const blocked = blockers(w);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const [x, y] = [c * TILE + TILE / 2, r * TILE + TILE / 2];
      const i = r * cols + c;
      m.zone[i] = w.districts.findIndex((d) => x > d.x && x < d.x + d.w && y > d.y && y < d.y + d.h);
      const inside = (b: Rect) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
      m.ok[i] = +((m.zone[i] >= 0 || isPath(cellAt(w.ground, c, r))) && !blocked.some(inside));
    }
  for (const d of w.districts) {
    const [gx, gy] = d.gate;
    for (const c of [gx / TILE - 1, gx / TILE]) for (const r of [gy / TILE - 1, gy / TILE]) m.gate[r * cols + c] = 1;
  }
  masks.set(w, m);
  return m;
}

/** The walkable cell nearest to a point in the same zone (a point in a house maps to the grass round it). */
function nearest(m: Mask, zone: number, x: number, y: number): number {
  const [c0, r0] = [Math.floor(x / TILE), Math.floor(y / TILE)];
  let best = -1;
  let bd = Infinity;
  for (let r = Math.max(0, r0 - 6); r <= Math.min(m.rows - 1, r0 + 6); r++)
    for (let c = Math.max(0, c0 - 6); c <= Math.min(m.cols - 1, c0 + 6); c++) {
      const i = r * m.cols + c;
      if (!m.ok[i] || m.zone[i] !== zone) continue;
      const d = Math.hypot(c * TILE + TILE / 2 - x, r * TILE + TILE / 2 - y);
      if (d < bd) [best, bd] = [i, d];
    }
  return best;
}

const zoneOf = (w: World, x: number, y: number) =>
  w.districts.findIndex((d) => x > d.x && x < d.x + d.w && y > d.y && y < d.y + d.h);

/** The cell the route to a point ends in, as a key: the route only needs redoing when this changes. */
export const goalKey = (w: World, x: number, y: number) => nearest(maskOf(w), zoneOf(w, x, y), x, y);

/**
 * Waypoints from one map point to another, tile centres and then `to` itself. Falls back to the straight line
 * when no route exists (a stale position, a target outside everything).
 */
export function findPath(w: World, from: Point, to: Point): Point[] {
  const m = maskOf(w);
  const s = nearest(m, zoneOf(w, ...from), ...from);
  const g = nearest(m, zoneOf(w, ...to), ...to);
  if (s < 0 || g < 0) return [to];
  const { cols } = m;
  const gc = g % cols;
  const gr = Math.floor(g / cols);
  const h = (i: number) => {
    const dx = Math.abs((i % cols) - gc);
    const dy = Math.abs(Math.floor(i / cols) - gr);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const cost = new Map<number, number>([[s, 0]]);
  const from_ = new Map<number, number>();
  // ponytail: sorted-insert open list; a map is a few thousand cells, a binary heap if that ever hurts
  const open: [number, number][] = [[h(s), s]];
  const done = new Set<number>();
  while (open.length) {
    const i = open.shift()![1];
    if (i === g) break;
    if (done.has(i)) continue;
    done.add(i);
    const [c, r] = [i % cols, Math.floor(i / cols)];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const [nc, nr] = [c + dc, r + dr];
        if ((!dc && !dr) || nc < 0 || nr < 0 || nc >= cols || nr >= m.rows) continue;
        const j = nr * cols + nc;
        if (!m.ok[j] || done.has(j)) continue;
        // A fence between two zones is crossed only at a gate, and a corner is never cut.
        if (m.zone[j] !== m.zone[i] && !(m.gate[i] && m.gate[j] && !dc)) continue;
        if (
          dc &&
          dr &&
          (!m.ok[r * cols + nc] ||
            !m.ok[nr * cols + c] ||
            m.zone[r * cols + nc] !== m.zone[i] ||
            m.zone[nr * cols + c] !== m.zone[i])
        )
          continue;
        const n = (cost.get(i) ?? 0) + (dc && dr ? Math.SQRT2 : 1);
        if (n >= (cost.get(j) ?? Infinity)) continue;
        cost.set(j, n);
        from_.set(j, i);
        const f = n + h(j);
        let k = open.findIndex(([of]) => of > f);
        if (k < 0) k = open.length;
        open.splice(k, 0, [f, j]);
      }
  }
  if (!from_.has(g) && g !== s) return [to];
  const cells: number[] = [g];
  for (let i = g; from_.has(i);) cells.unshift((i = from_.get(i)!));
  const pts = cells.map((i): Point => [(i % cols) * TILE + TILE / 2, Math.floor(i / cols) * TILE + TILE / 2]);
  // Start from where the crab stands: skip the first centre when the next one is nearer.
  if (
    pts.length > 1 &&
    Math.hypot(pts[1][0] - from[0], pts[1][1] - from[1]) < Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
  )
    pts.shift();
  return [...pts, to];
}
