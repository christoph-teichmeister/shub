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
