// Runs one plugin process: no shell, restart with exponential backoff, last log lines in memory.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export const MAX_LOG_LINES = 500;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
/** A run this long counts as healthy and resets the backoff. */
const STABLE_MS = 60_000;
const KILL_AFTER_MS = 5000;

export interface PluginProcessOptions {
  name: string;
  dir: string;
  command: string[];
  /** Fresh env (with a fresh token) for every spawn; `release` is called when that process ends. */
  env: () => { vars: Record<string, string>; release: () => void };
  backoff?: { minMs: number; maxMs: number };
}

export class PluginProcess {
  readonly logs: string[] = [];
  #opts: PluginProcessOptions;
  #child: ChildProcess | null = null;
  #stopping = false;
  #timer: NodeJS.Timeout | null = null;
  #delay: number;

  constructor(opts: PluginProcessOptions) {
    this.#opts = opts;
    this.#delay = opts.backoff?.minMs ?? MIN_BACKOFF_MS;
  }

  get running(): boolean {
    return this.#child !== null;
  }

  start(): void {
    this.#stopping = false;
    this.#spawn();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    const child = this.#child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
    await exited;
    clearTimeout(kill);
  }

  #log(line: string): void {
    this.logs.push(`${new Date().toISOString()} ${line}`);
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
  }

  #spawn(): void {
    const [cmd, ...args] = this.#opts.command;
    const { vars, release } = this.#opts.env();
    const startedAt = Date.now();
    const child = spawn(cmd, args, {
      cwd: this.#opts.dir,
      env: { ...process.env, ...vars },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.#child = child;
    this.#log(`[shub] started: ${this.#opts.command.join(' ')}`);
    createInterface({ input: child.stdout! }).on('line', (l) => this.#log(l));
    createInterface({ input: child.stderr! }).on('line', (l) => this.#log(`[stderr] ${l}`));

    let ended = false;
    const onEnd = (why: string) => {
      if (ended) return;
      ended = true;
      release();
      this.#child = null;
      this.#log(`[shub] ${why}`);
      if (this.#stopping) return;
      const { minMs, maxMs } = this.#opts.backoff ?? { minMs: MIN_BACKOFF_MS, maxMs: MAX_BACKOFF_MS };
      if (Date.now() - startedAt >= STABLE_MS) this.#delay = minMs;
      this.#log(`[shub] restarting in ${Math.round(this.#delay / 1000)}s`);
      this.#timer = setTimeout(() => this.#spawn(), this.#delay);
      this.#delay = Math.min(this.#delay * 2, maxMs);
    };
    child.on('error', (err) => onEnd(`failed: ${err.message}`));
    child.on('close', (code, signal) => onEnd(`exited (${signal ?? code})`));
  }
}
