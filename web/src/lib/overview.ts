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
