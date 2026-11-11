import type { Session, SessionStatus } from '../../../shared/api.ts';

/** Overview order: what needs you first, then what is running, then the quiet ones. */
const RANK: Record<SessionStatus, number> = {
  'needs-you': 0,
  working: 1,
  'your-turn': 2,
  waiting: 3,
  starting: 4,
  new: 4,
  paused: 5,
  exited: 6,
};

/** The sessions the overview shows: top-level project Claude sessions (not the global one) that are not over, in overview order, optionally of
 *  one project. `all` is the whole store (a pane's attention rolls up into its parent), oldest first within a rank. */
export function overviewSessions(all: Session[], projectId: string | null = null): Session[] {
  const hot = (s: Session) => all.some((k) => k.parentId === s.id && k.status === 'needs-you');
  const rank = (s: Session) => (hot(s) ? 0 : RANK[s.status]);
  return all
    .filter(
      (s) =>
        !s.parentId &&
        s.kind !== 'shell' &&
        s.kind !== 'global' &&
        s.status !== 'exited' &&
        (!projectId || s.projectId === projectId),
    )
    .sort((a, b) => rank(a) - rank(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
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
