import type { Session, SessionStatus } from '../../../shared/api.ts';

/** The sessions the overview shows: top-level project Claude sessions (not the global one) that are not over, optionally
 *  of one project. The order is stable (oldest first, new ones append) so panes never jump while you type; attention is
 *  shown by the pane's border and badge, not by position. */
export function overviewSessions(all: Session[], projectId: string | null = null): Session[] {
  return all
    .filter(
      (s) =>
        !s.parentId &&
        s.kind !== 'shell' &&
        s.kind !== 'global' &&
        s.status !== 'exited' &&
        (!projectId || s.projectId === projectId),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Statuses that get a live terminal in the overview; the quiet rest (paused, not started) stay small cards. */
export const LIVE = new Set<SessionStatus>(['needs-you', 'working', 'your-turn', 'waiting']);

/** Columns for `n` panes in a `w` x `h` area: the count whose cells come closest to a terminal's 8:5 shape. */
export function gridColumns(n: number, w: number, h: number): number {
  let best = 1;
  let off = Infinity;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const d = Math.abs(Math.log(w / c / (h / Math.ceil(n / c)) / 1.6));
    if (d < off) [best, off] = [c, d];
  }
  return best;
}

/** Index of the pane next to `i` in a grid of `n` panes in `cols` columns, or `i` at an edge. Down from a column the
 *  short last row lacks goes to the last pane. */
export function neighbour(i: number, dir: 'left' | 'right' | 'up' | 'down', cols: number, n: number): number {
  if (dir === 'left') return i % cols ? i - 1 : i;
  if (dir === 'right') return i % cols < cols - 1 && i + 1 < n ? i + 1 : i;
  if (dir === 'up') return i >= cols ? i - cols : i;
  if (i + cols < n) return i + cols;
  return Math.floor(i / cols) < Math.floor((n - 1) / cols) ? n - 1 : i;
}

/** The minimized ids that still name a session; an empty store (not loaded yet) leaves the list alone. */
export function pruneMinimized(ids: string[], all: Session[]): string[] {
  if (!all.length) return ids;
  const live = ids.filter((id) => all.some((s) => s.id === id));
  return live.length === ids.length ? ids : live;
}

/** Most live terminals at once: beyond this the cells get too small to read, and every pane resizes its session's PTY. */
export const MAX_LIVE = 6;

/** Splits overview-ordered `wanted` (sessions that want a live pane) into the `max` that get one and the overflow.
 *  Needs-you sessions always get one; `promoted` (the user's "Show") come next, then overview order, so the newest
 *  non-urgent ones are displaced first. */
export function capLive(wanted: Session[], max: number, promoted: string[] = []): { live: Session[]; over: Session[] } {
  const tier = (s: Session) => (s.status === 'needs-you' ? 0 : promoted.includes(s.id) ? 1 : 2);
  const keep = new Set(
    wanted
      .map((s, i) => ({ s, i }))
      .sort((a, b) => tier(a.s) - tier(b.s) || a.i - b.i)
      .filter(({ s }, n) => tier(s) === 0 || n < max)
      .map(({ s }) => s.id),
  );
  return { live: wanted.filter((s) => keep.has(s.id)), over: wanted.filter((s) => !keep.has(s.id)) };
}

/** Free-tiling layout: a leaf is a session id, a split lays its children out in a row or column with a size ratio each
 *  (sizes sum to 1). Every function below is pure and returns a new tree. */
export type Layout = string | Split;
export interface Split {
  dir: 'row' | 'col';
  children: Layout[];
  sizes: number[];
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest share a child keeps when resized. Six children (MAX_LIVE) in one split still fit (1/6 > 0.15). */
export const MIN_SIZE = 0.15;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The leaf ids in tree order. */
export function leaves(t: Layout | null): string[] {
  return t === null ? [] : typeof t === 'string' ? [t] : t.children.flatMap(leaves);
}

/** The tree without leaves `keep` rejects: one-child splits collapse into the child, the rest share the freed space. */
function prune(t: Layout | null, keep: (id: string) => boolean): Layout | null {
  if (t === null) return null;
  if (typeof t === 'string') return keep(t) ? t : null;
  const children: Layout[] = [];
  const sizes: number[] = [];
  t.children.forEach((c, i) => {
    const p = prune(c, keep);
    if (p !== null) [children[children.length], sizes[sizes.length]] = [p, t.sizes[i]];
  });
  if (children.length < 2) return children[0] ?? null;
  const total = sum(sizes);
  return { dir: t.dir, children, sizes: sizes.map((x) => x / total) };
}

function replaceLeaf(t: Layout, id: string, by: Layout): Layout {
  if (typeof t === 'string') return t === id ? by : t;
  return { ...t, children: t.children.map((c) => replaceLeaf(c, id, by)) };
}

/** Where every leaf sits, in 0..1 of the whole area. */
export function rects(t: Layout | null, box: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Rect>()) {
  if (t === null) return out;
  if (typeof t === 'string') return out.set(t, box);
  let at = 0;
  t.children.forEach((c, i) => {
    const s = t.sizes[i];
    rects(
      c,
      t.dir === 'row'
        ? { x: box.x + at * box.w, y: box.y, w: box.w * s, h: box.h }
        : { x: box.x, y: box.y + at * box.h, w: box.w, h: box.h * s },
      out,
    );
    at += s;
  });
  return out;
}

const even = (dir: 'row' | 'col', children: Layout[]): Layout =>
  children.length === 1 ? children[0] : { dir, children, sizes: children.map(() => 1 / children.length) };

/** The auto grid as a tree: rows of `cols` panes, the short last row's panes share the whole row; null when empty. */
export function gridLayout(ids: string[], cols: number): Layout | null {
  const rows: Layout[] = [];
  for (let i = 0; i < ids.length; i += cols) rows.push(even('row', ids.slice(i, i + cols)));
  return rows.length ? even('col', rows) : null;
}

/** Fits the tree to the live sessions: drops dead and duplicate leaves, collapses what is left, and gives every live
 *  session without a leaf one by halving the largest leaf along its longer side. */
export function reconcile(tree: Layout | null, liveIds: string[]): Layout | null {
  const live = new Set(liveIds);
  const seen = new Set<string>();
  let t = prune(tree, (id) => live.has(id) && !seen.has(id) && !!seen.add(id));
  for (const id of liveIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (t === null) {
      t = id;
      continue;
    }
    let big = '';
    let area = -1;
    for (const [k, r] of rects(t)) if (r.w * r.h > area + 1e-9) [big, area] = [k, r.w * r.h];
    const r = rects(t).get(big)!;
    t = replaceLeaf(t, big, { dir: r.w >= r.h ? 'row' : 'col', children: [big, id], sizes: [0.5, 0.5] });
  }
  return t;
}

/** Applies `fn` to the split at `path` (child indexes from the root); an invalid path leaves the tree alone. */
function atSplit(t: Layout, path: number[], fn: (s: Split) => Split): Layout {
  if (typeof t === 'string') return t;
  if (!path.length) return fn(t);
  const [i, ...rest] = path;
  if (!t.children[i]) return t;
  return { ...t, children: t.children.map((c, j) => (j === i ? atSplit(c, rest, fn) : c)) };
}

/** Sets the sizes of the split at `path`. Ignored unless there is one size per child, each at least MIN_SIZE. */
export function setSizes(t: Layout, path: number[], sizes: number[]): Layout {
  return atSplit(t, path, (s) =>
    sizes.length === s.children.length && sizes.every((x) => x >= MIN_SIZE - 1e-9)
      ? { ...s, sizes: sizes.map((x) => x / sum(sizes)) }
      : s,
  );
}

/** Moves the divider after child `index` of the split at `path` by `delta` (a ratio; negative = up/left); neither
 *  neighbour shrinks below MIN_SIZE. */
export function resize(t: Layout, path: number[], index: number, delta: number): Layout {
  return atSplit(t, path, (s) => {
    if (index < 0 || index + 1 >= s.sizes.length) return s;
    // A neighbour already under MIN_SIZE (halving can do that) keeps its size at the least instead of jumping up.
    const [a, b] = [s.sizes[index], s.sizes[index + 1]];
    const d = Math.min(Math.max(delta, Math.min(MIN_SIZE, a) - a), b - Math.min(MIN_SIZE, b));
    const sizes = s.sizes.slice();
    sizes[index] += d;
    sizes[index + 1] -= d;
    return { ...s, sizes };
  });
}

/** Gives every child of the split at `path` the same share. */
export function equalize(t: Layout, path: number[]): Layout {
  return atSplit(t, path, (s) => ({ ...s, sizes: s.sizes.map(() => 1 / s.sizes.length) }));
}

/** Exchanges the places of two leaves. */
export function swap(t: Layout, a: string, b: string): Layout {
  const ids = leaves(t);
  if (a === b || !ids.includes(a) || !ids.includes(b)) return t;
  const go = (n: Layout): Layout =>
    typeof n === 'string' ? (n === a ? b : n === b ? a : n) : { ...n, children: n.children.map(go) };
  return go(t);
}

/** Takes leaf `from` out and puts it on the `edge` of leaf `to`, splitting that leaf's cell in half. */
export function moveToEdge(t: Layout, from: string, to: string, edge: 'top' | 'bottom' | 'left' | 'right'): Layout {
  const ids = leaves(t);
  if (from === to || !ids.includes(from) || !ids.includes(to)) return t;
  const rest = prune(t, (id) => id !== from)!;
  const first = edge === 'top' || edge === 'left';
  return replaceLeaf(rest, to, {
    dir: edge === 'top' || edge === 'bottom' ? 'col' : 'row',
    children: first ? [from, to] : [to, from],
    sizes: [0.5, 0.5],
  });
}

/** The leaf nearest to `id` in direction `dir` by where the panes really sit (centres, a sideways offset counts double),
 *  or `id` at an edge. Works for any tree; the auto grid keeps using neighbour(). */
export function neighbourByRect(t: Layout | null, id: string, dir: 'left' | 'right' | 'up' | 'down'): string {
  const all = rects(t);
  const r = all.get(id);
  if (!r) return id;
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = id;
  let score = Infinity;
  for (const [k, o] of all) {
    const dx = o.x + o.w / 2 - (r.x + r.w / 2);
    const dy = o.y + o.h / 2 - (r.y + r.h / 2);
    const [main, cross] = horizontal ? [dx, dy] : [dy, dx];
    // the whole pane must lie beyond the edge, not just its centre
    const gap = { left: r.x - (o.x + o.w), right: o.x - (r.x + r.w), up: r.y - (o.y + o.h), down: o.y - (r.y + r.h) }[
      dir
    ];
    if (k !== id && gap > -1e-9 && main * sign + 2 * Math.abs(cross) < score)
      [best, score] = [k, main * sign + 2 * Math.abs(cross)];
  }
  return best;
}

/** Drop zone for a point at (`fx`, `fy`) in 0..1 of a pane: the nearest edge when within the outer quarter, else swap. */
export function dropZone(fx: number, fy: number): 'top' | 'bottom' | 'left' | 'right' | 'center' {
  const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
  const edge = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
  return d[edge] < 0.25 ? edge : 'center';
}

export const serializeLayout = (t: Layout): string => JSON.stringify(t);

/** The tree in `raw` (a localStorage value), or null when it is missing or not a sound tree: bad JSON, wrong shapes,
 *  a split with fewer than two children, mismatched or non-positive sizes, a repeated id. Sizes are renormalised. */
export function parseLayout(raw: string | null): Layout | null {
  const seen = new Set<string>();
  const check = (v: unknown): Layout | null => {
    if (typeof v === 'string') return v && !seen.has(v) && !!seen.add(v) ? v : null;
    if (typeof v !== 'object' || v === null) return null;
    const { dir, children, sizes } = v as Partial<Split>;
    if ((dir !== 'row' && dir !== 'col') || !Array.isArray(children) || !Array.isArray(sizes)) return null;
    if (children.length < 2 || sizes.length !== children.length) return null;
    if (!sizes.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) return null;
    const kids = children.map(check);
    if (kids.includes(null)) return null;
    const total = sum(sizes);
    return { dir, children: kids as Layout[], sizes: sizes.map((x) => x / total) };
  };
  try {
    return raw === null ? null : check(JSON.parse(raw));
  } catch {
    return null;
  }
}
