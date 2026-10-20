import type { SessionStatus } from '../../../shared/api.ts';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  new: 'not started',
  'needs-you': 'needs you',
  working: 'working',
  'your-turn': 'your turn',
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
