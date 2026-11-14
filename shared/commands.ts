// Where a handed-over command runs. Shared so the chip shows the same target the server sends it to.
import type { HandedCommand, Session } from './api.ts';

export type CommandTarget =
  | { kind: 'self' }
  /** `running` is a guess from the status; the server checks tmux and resumes the session when it is not. */
  | { kind: 'session'; session: Session; running: boolean }
  /** A `cwd=` folder other than this session's own: only "Open in terminal" there. */
  | { kind: 'folder'; cwd: string }
  | { kind: 'unknown'; ref: string };

const DOWN = new Set(['exited', 'paused']);

export function commandTarget(command: HandedCommand, sessions: Session[], fromId: string): CommandTarget {
  // A folder never reroutes to another Claude there (it would type into someone else's prompt): own folder = self,
  // any other = a terminal in it. Only an explicit `session=` names another session.
  if (!command.session) {
    if (command.cwd && sessions.find((s) => s.id === fromId)?.cwd !== command.cwd)
      return { kind: 'folder', cwd: command.cwd };
    return { kind: 'self' };
  }
  const target = sessions.find((s) => s.id === command.session);
  if (target?.id === fromId) return { kind: 'self' };
  if (target) return { kind: 'session', session: target, running: !DOWN.has(target.status) };
  return { kind: 'unknown', ref: command.session };
}
