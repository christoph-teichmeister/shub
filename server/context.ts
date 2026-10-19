// Shared runtime context handed to every server module: paths, settings and the event bus.
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent } from '../shared/api.ts';

export interface Paths {
  /** ~/.config/shub: versionable config (no secrets). */
  configDir: string;
  /** ~/.local/state/shub: secrets, runtime state, sqlite db, pasted files. */
  stateDir: string;
  /** Folder of this checkout (for hook scripts, built web app). */
  appDir: string;
}

export interface Context {
  paths: Paths;
  host: string;
  port: number;
  /** tmux socket name, always passed as `tmux -L <socket>`. */
  tmuxSocket: string;
  bus: EventBus;
}

export class EventBus {
  #emitter = new EventEmitter();

  emit(event: ServerEvent): void {
    this.#emitter.emit('event', event);
  }

  on(listener: (event: ServerEvent) => void): () => void {
    this.#emitter.on('event', listener);
    return () => this.#emitter.off('event', listener);
  }
}

export function createContext(env: NodeJS.ProcessEnv = process.env): Context {
  const home = homedir();
  return {
    paths: {
      configDir: env.SHUB_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'shub'),
      stateDir: env.SHUB_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'shub'),
      appDir: new URL('..', import.meta.url).pathname,
    },
    // Never bind anything but loopback; phone access goes through `tailscale serve`.
    host: '127.0.0.1',
    port: Number(env.SHUB_PORT ?? 4780),
    tmuxSocket: env.SHUB_TMUX_SOCKET ?? 'shub',
    bus: new EventBus(),
  };
}
