import type { Session, SessionStatus } from '../../../shared/api.ts';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  new: 'not started',
  'needs-you': 'needs you',
  working: 'working',
  'your-turn': 'your turn',
  waiting: 'waiting',
  paused: 'paused',
  exited: 'exited',
};

/** Sidebar badge for a project: needs-you wins, then working; nothing when idle. */
export function projectBadge(statuses: SessionStatus[]): { text: string; tone: 'needs-you' | 'working' } | null {
  const needs = statuses.filter((s) => s === 'needs-you').length;
  if (needs) return { text: `${needs} ${needs === 1 ? 'needs' : 'need'} you`, tone: 'needs-you' };
  const working = statuses.filter((s) => s === 'working').length;
  return working ? { text: `${working} working`, tone: 'working' } : null;
}

/** Tooltip for a waiting session: what for, and the background check's last answer. */
export function waitTitle(s: Session): string | undefined {
  if (!s.waitingFor) return undefined;
  const check = s.waitCheck;
  if (!check) return `Waiting for: ${s.waitingFor}`;
  const last = check.last ?? 'first check running…';
  return `Waiting for: ${s.waitingFor}\nHaiku checks every ${check.everyMinutes} min. Last: ${last}`;
}

/** Default order of a project's sessions in the sidebar; everything else after these, oldest first. */
const RANK: Partial<Record<SessionStatus, number>> = { 'needs-you': 0, 'your-turn': 1, working: 2 };

/**
 * A session the user dragged keeps its place (`position`); the rest fill the gaps,
 * by status when `byStatus` (sidebar), else oldest first (tabs).
 */
export function placeSessions<S extends { status: SessionStatus; position?: number | null }>(
  list: S[],
  byStatus: boolean,
): S[] {
  const rank = (s: S) => (byStatus ? (RANK[s.status] ?? 3) : 0);
  const free = list.filter((s) => s.position == null).sort((a, b) => rank(a) - rank(b));
  const pinned = list.filter((s) => s.position != null).sort((a, b) => a.position! - b.position!);
  const out: S[] = [];
  while (pinned.length || free.length)
    out.push(pinned.length && (pinned[0].position! <= out.length || !free.length) ? pinned.shift()! : free.shift()!);
  return out;
}

/** Positions to save after dragging `id` before `beforeId` (null: to the end) in the shown `list`. */
export function dropPositions<S extends { id: string; position?: number | null }>(
  list: S[],
  id: string,
  beforeId: string | null,
): Record<string, number> {
  const moving = list.find((s) => s.id === id);
  if (!moving || id === beforeId) return {};
  const rest = list.filter((s) => s !== moving);
  const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  return Object.fromEntries(rest.flatMap((s, i) => (s === moving || s.position != null ? [[s.id, i] as const] : [])));
}
