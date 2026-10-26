// tmux on shub's own socket. Every call passes `-L <socket>` and `-f <conf>`, so the user's server is never touched.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { HttpError } from '../api/router.ts';

// -f is only read when the server starts, which is exactly when these must apply (history-limit only
// affects panes created after it is set).
const CONF = `set -g window-size latest
set -g mouse on
set -g history-limit 50000
set -s escape-time 0
set -g status off
set -g default-terminal tmux-256color
`;

export const TMUX_MISSING =
  'tmux is not installed: shub needs tmux 3.3 or newer (apt install tmux, brew install tmux), then restart shub';

export class Tmux {
  readonly socket: string;
  #conf: string;

  constructor(socket: string, confFile: string) {
    this.socket = socket;
    this.#conf = confFile;
    writeFileSync(confFile, CONF);
  }

  run(args: string[], input?: string): string {
    try {
      return execFileSync('tmux', ['-L', this.socket, '-f', this.#conf, ...args], {
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(503, TMUX_MISSING);
      throw err;
    }
  }

  newSession(name: string, cwd: string, env: Record<string, string>, argv: string[]): void {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    // Several argv words: tmux execs them directly, no shell quoting of the prompt needed.
    this.run(['new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', ...envArgs, '--', ...argv]);
  }

  sessions(): Set<string> {
    try {
      return new Set(this.run(['list-sessions', '-F', '#{session_name}']).split('\n').filter(Boolean));
    } catch {
      return new Set(); // no server running
    }
  }

  has(name: string): boolean {
    return this.sessions().has(name);
  }

  kill(name: string): void {
    try {
      this.run(['kill-session', '-t', `=${name}`]);
    } catch {
      // already gone
    }
  }

  sendKey(name: string, key: string): void {
    this.run(['send-keys', '-t', `=${name}:`, key]);
  }

  sendLiteral(name: string, text: string): void {
    this.run(['send-keys', '-t', `=${name}:`, '-l', '--', text]);
  }

  /** The folder the pane's shell is in right now (follows `cd`). */
  currentPath(name: string): string {
    return this.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}']).trim();
  }

  /** Bracketed paste, so Claude sees one paste instead of typed lines. load-buffer avoids argv size limits. */
  paste(name: string, text: string): void {
    const buffer = `shub-${name}`;
    this.run(['load-buffer', '-b', buffer, '-'], text);
    this.run(['paste-buffer', '-p', '-d', '-b', buffer, '-t', `=${name}:`]);
  }

  /** Only for tests: kill this (test) socket's server. */
  killServer(): void {
    try {
      this.run(['kill-server']);
    } catch {
      // not running
    }
  }
}
