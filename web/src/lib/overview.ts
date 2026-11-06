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

/** The sessions the overview shows: top-level Claude sessions that are not over, in overview order, optionally of
 *  one project. `all` is the whole store (a pane's attention rolls up into its parent), oldest first within a rank. */
export function overviewSessions(all: Session[], projectId: string | null = null): Session[] {
  const hot = (s: Session) => all.some((k) => k.parentId === s.id && k.status === 'needs-you');
  const rank = (s: Session) => (hot(s) ? 0 : RANK[s.status]);
  return all
    .filter(
      (s) => !s.parentId && s.kind !== 'shell' && s.status !== 'exited' && (!projectId || s.projectId === projectId),
    )
    .sort((a, b) => rank(a) - rank(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
