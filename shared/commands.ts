// Where a handed-over command runs. Shared so the chip shows the same target the server sends it to.
import type { HandedCommand, Session } from './api.ts';

export type CommandTarget =
  | { kind: 'self' }
  /** `running` is a guess from the status; the server checks tmux and resumes the session when it is not. */
  | { kind: 'session'; session: Session; running: boolean }
  /** No live Claude in that folder: only "Open in terminal" there. */
  | { kind: 'folder'; cwd: string }
  | { kind: 'unknown'; ref: string };

const DOWN = new Set(['exited', 'paused']);

export function commandTarget(command: HandedCommand, sessions: Session[], fromId: string): CommandTarget {
  const target = command.session
    ? sessions.find((s) => s.id === command.session)
    : command.cwd
      ? sessions.find((s) => s.kind !== 'shell' && s.cwd === command.cwd && !DOWN.has(s.status))
      : undefined;
  if (target?.id === fromId || (!command.session && !command.cwd)) return { kind: 'self' };
  if (target) return { kind: 'session', session: target, running: !DOWN.has(target.status) };
  if (command.cwd) return { kind: 'folder', cwd: command.cwd };
  return { kind: 'unknown', ref: command.session! };
}
