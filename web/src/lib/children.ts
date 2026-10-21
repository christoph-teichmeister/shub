// Worktrees a session created, nested under it in the sidebar (and listed on the phone).
import type { ChildWorktree, Session, StartSessionRequest } from '../../../shared/api.ts';

const within = (cwd: string, path: string) => cwd === path || cwd.startsWith(`${path}/`);

/** Sessions running in the worktree, its creator left out (it may have entered the worktree itself). */
export const sessionsIn = (w: ChildWorktree, sessions: Session[]): Session[] =>
  sessions.filter((s) => s.id !== w.originSessionId && s.kind === 'claude' && within(s.cwd, w.path));

/** What a click on a dormant row starts: the newest conversation there resumed, else a fresh Claude. None while busy. */
export function childStart(w: ChildWorktree): StartSessionRequest | null {
  if (w.busy || w.state === 'folder-gone') return null;
  const request: StartSessionRequest = { projectId: w.projectId, kind: 'claude', cwd: w.path, name: w.name };
  return w.conversation ? { ...request, resumeClaudeSessionId: w.conversation } : request;
}

/** The status text of a dormant row. */
export const childLabel = (w: ChildWorktree): string => (w.busy ? 'working' : w.state.replace('-', ' '));

/**
 * Where each child shows: under its creator while that session is live, else under its project.
 * `nested` are the sessions that run in a shown child: they leave the project's top level.
 * An orphan with a session running in it is left out: that session shows at the top level like any other.
 */
export function placeChildren(children: ChildWorktree[], sessions: Session[]) {
  const live = new Set(sessions.map((s) => s.id));
  const byOrigin = new Map<string, ChildWorktree[]>();
  const orphans = new Map<string, ChildWorktree[]>();
  const nested = new Set<string>();
  for (const w of children) {
    const inside = sessionsIn(w, sessions);
    if (!live.has(w.originSessionId) && inside.length) continue;
    const [key, map] = live.has(w.originSessionId) ? [w.originSessionId, byOrigin] : [w.projectId, orphans];
    map.set(key, [...(map.get(key) ?? []), w]);
    for (const s of inside) nested.add(s.id);
  }
  return { byOrigin, orphans, nested };
}
