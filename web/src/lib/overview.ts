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
