import { COMPACT_AT, type Session, type SessionStatus } from '../../../shared/api.ts';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  new: 'not started',
  'needs-you': 'needs you',
  working: 'working',
  'your-turn': 'your turn',
  waiting: 'waiting',
  paused: 'paused',
  starting: 'starting…',
  exited: 'exited',
};

/** The turn is over and only background agents still run: working underneath, but nothing is typing. */
export const idleWithAgents = (s: Session): boolean => s.status === 'working' && !!s.background && !!s.agents?.length;

/** /compact typed into a running turn would queue as a prompt: only offered once the turn is over.
 *  A needs-you without an open permission question is Claude's idle reminder, so it counts. */
export const canCompact = (s: Session): boolean =>
  s.status === 'your-turn' || (s.status === 'needs-you' && !s.pendingPermission);

const commandCount = (n: number) => `${n} ${n === 1 ? 'command' : 'commands'}`;

/** Status text of one session: a needs-you that waits for commands Claude handed over says so,
 *  a finished turn names the background shells still running. */
export function statusLabel(s: Session): string {
  if (s.status === 'needs-you' && s.pendingCommands?.length) return `▶ ${commandCount(s.pendingCommands.length)}`;
  const agents = s.agents?.length ?? 0;
  if (idleWithAgents(s)) return `idle · ${agents} ${agents === 1 ? 'agent' : 'agents'}`;
  const shells = s.status !== 'working' && s.shells ? ` · ${s.shells} ${s.shells === 1 ? 'shell' : 'shells'}` : '';
  return STATUS_LABEL[s.status] + shells;
}

/** Sidebar badge for projects and groups: needs-you wins (commands only, if that is all it is), then working. */
export function projectBadge(sessions: Session[]): { text: string; tone: 'needs-you' | 'working' } | null {
  const needs = sessions.filter((s) => s.status === 'needs-you');
  if (needs.length) {
    const text = needs.every((s) => s.pendingCommands?.length)
      ? commandCount(needs.length)
      : `${needs.length} ${needs.length === 1 ? 'needs' : 'need'} you`;
    return { text, tone: 'needs-you' };
  }
  const working = sessions.filter((s) => s.status === 'working' && !idleWithAgents(s)).length;
  return working ? { text: `${working} working`, tone: 'working' } : null;
}

/** Tooltip for a waiting session: what for, and the background check's last answer. */
export function waitTitle(s: Session): string | undefined {
  if (!s.waitingFor) return undefined;
  const check = s.waitCheck;
  if (!check) return `Waiting for: ${s.waitingFor}`;
  const last = check.last ?? 'first check running…';
  const then = check.onDone ? `Then sends: ${check.onDone}` : 'Then notifies you.';
  return `Waiting for: ${s.waitingFor}\nHaiku checks every ${check.everyMinutes} min. ${then} Last: ${last}`;
}

/** Default order of a project's sessions in the sidebar; everything else after these, oldest first. */
const RANK: Partial<Record<SessionStatus, number>> = { 'needs-you': 0, 'your-turn': 1, working: 2 };

/** Sidebar order: pinned sessions (`position`) on top in their pinned order, then the rest by status. */
export function placeSessions<S extends { status: SessionStatus; position?: number | null }>(list: S[]): S[] {
  const pinned = list.filter((s) => s.position != null).sort((a, b) => a.position! - b.position!);
  const free = list.filter((s) => s.position == null).sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3));
  return [...pinned, ...free];
}

/** Tab order: dragged tabs (`tabPosition`) in that order, then the rest oldest first. */
export function placeTabs<S extends { tabPosition?: number | null }>(list: S[]): S[] {
  const at = (s: S) => s.tabPosition ?? Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => at(a) - at(b));
}

/**
 * Positions to save after dragging `id` before `beforeId` (null: to the end) in the shown `list`:
 * the moved session and every pinned one (`position` set), or with `all` every session (tab order).
 */
export function dropPositions<S extends { id: string; position?: number | null }>(
  list: S[],
  id: string,
  beforeId: string | null,
  all = false,
): Record<string, number> {
  const moving = list.find((s) => s.id === id);
  if (!moving || id === beforeId) return {};
  const rest = list.filter((s) => s !== moving);
  const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  return Object.fromEntries(
    rest.flatMap((s, i) => (all || s === moving || s.position != null ? [[s.id, i] as const] : [])),
  );
}

// Colour by tokens, not percent: a 1M window would stay quiet far past the point where a session gets slow and
// expensive. These are 60 % and 80 % of a 200k window.
export const WARN_AT = 120_000;

const tokensLabel = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

/** How full a session's context is: percent of the window, colour level by tokens, tooltip line, and whether to
 *  offer /compact. */
export function contextFill(
  s: Session,
): { pct: number; level: 'low' | 'mid' | 'high'; title: string; compact: boolean } | null {
  if (!s.context) return null;
  const { tokens, window } = s.context;
  const pct = Math.min(100, Math.round((tokens / window) * 100));
  const compact = tokens >= COMPACT_AT;
  const level = compact ? 'high' : tokens >= WARN_AT ? 'mid' : 'low';
  return { pct, level, compact, title: `Context ${tokensLabel(tokens)} / ${tokensLabel(window)} · ${pct} %` };
}
