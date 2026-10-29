// Projects, groups, themes and settings live as versioned items in the group store (server/group), no secrets.
// Paths under home are stored as `~/...` so each host expands them to its own home. local.json in configDir holds
// what stays on this machine; its keys win over the store. A config.json from before is imported once, on first start.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { Config, Project, ProjectView, ResolvedIcon, ThemeDef } from '../../shared/api.ts';
import type { Context, EventBus } from '../context.ts';
import { HttpError } from '../api/router.ts';
import type { ShubModule } from '../module.ts';
import type { GroupStore } from '../group/index.ts';
import type { ConfigStore, Services } from '../services.ts';
import { isLaunchPermissionMode } from '../sessions/launch.ts';

export const DEFAULT_ACCENT = '#f92672';
const STATUS_ORANGE = '#fd971f';

// Colours of built-in themes live in web/src/lib/tokens; config only names them.
export const BUILT_IN_THEMES: ThemeDef[] = [
  { id: 'monokai', name: 'Monokai', builtIn: true, tokens: {} },
  { id: 'dracula', name: 'Dracula', builtIn: true, tokens: {} },
  { id: 'neutral-dark', name: 'Neutral dark', builtIn: true, tokens: {} },
];

export function defaultConfig(): Config {
  return {
    version: 1,
    groups: [],
    projects: [],
    themes: structuredClone(BUILT_IN_THEMES),
    activeTheme: 'monokai',
    notifications: { desktopNeedsYou: true, pushNeedsYou: true, pushYourTurn: false, noPushWhileDesktopFocused: true },
    plugins: [],
    defaultPermissionMode: 'default',
  };
}

/** Fills in fields a hand-edited or older file lacks; built-in themes are always present and unchanged. */
function normalize(raw: Partial<Config>): Config {
  const base = defaultConfig();
  const custom = (raw.themes ?? []).filter((t) => !BUILT_IN_THEMES.some((b) => b.id === t.id));
  const config: Config = {
    ...base,
    ...raw,
    version: 1,
    notifications: { ...base.notifications, ...raw.notifications },
    themes: [...base.themes, ...custom.map((t) => ({ ...t, builtIn: false }))],
    defaultPermissionMode: isLaunchPermissionMode(raw.defaultPermissionMode) ? raw.defaultPermissionMode : 'default',
  };
  if (config.updateChannel !== 'stable' && config.updateChannel !== 'beta') delete config.updateChannel;
  if (!['auto', 'ask', 'off'].includes(config.updateMode!)) delete config.updateMode;
  if (config.trustSessions !== true) delete config.trustSessions;
  if (!/^https:\/\/\S+$/.test(config.publicUrl ?? '')) delete config.publicUrl;
  delete config.problem;
  return config;
}

/** Keys that always go to local.json; any other key the user puts there stays local too. */
export const LOCAL_KEYS: (keyof Config)[] = ['updateChannel', 'updateMode', 'trustSessions', 'publicUrl', 'sync'];

/** The address the phone reaches shub at: SHUB_PUBLIC_URL, else the one the phone setup stored. No trailing slash. */
export function publicUrl(config: Config): string | undefined {
  return (process.env.SHUB_PUBLIC_URL || config.publicUrl)?.replace(/\/$/, '');
}

export function contractHome(path: string, home: string): string {
  if (path === home) return '~';
  return path.startsWith(home + sep) ? '~' + path.slice(home.length) : path;
}

export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? home + path.slice(1) : path;
}

const mapPaths = (config: Partial<Config>, fn: (path: string) => string): Partial<Config> =>
  config.projects ? { ...config, projects: config.projects.map((p) => ({ ...p, path: fn(p.path) })) } : config;

export function hostOfRemote(remote: string): string | null {
  const scp = /^[^@/]+@([^:/]+):/.exec(remote); // git@github.com:owner/repo.git
  if (scp) return scp[1].toLowerCase();
  try {
    return new URL(remote).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function iconForHost(host: string | null): ResolvedIcon {
  if (!host) return { kind: 'none' };
  if (host === 'github.com' || host.endsWith('.github.com')) return { kind: 'github', host };
  if (host.includes('gitlab')) return { kind: 'gitlab', host };
  return { kind: 'none', host };
}

function gitRemote(path: string): string | null {
  try {
    return execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

/** github / gitlab / none, from `git remote get-url origin` (uncached). */
export function remoteIcon(path: string): ResolvedIcon {
  const remote = gitRemote(path);
  return iconForHost(remote && hostOfRemote(remote));
}

/** The browser URL of a remote: `git@host:a/b.git` / `ssh://git@host:22/a/b.git` / `https://user@host/a/b.git` -> `https://host/a/b`. */
export function webUrlOfRemote(remote: string): string | null {
  const scp = /^[^@/]+@([^:/]+):(?!\/)(.+)$/.exec(remote);
  let host: string, path: string;
  if (scp) [, host, path] = scp;
  else {
    try {
      const url = new URL(remote);
      if (!['ssh:', 'git:', 'http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
      [host, path] = [url.hostname, url.pathname];
    } catch {
      return null;
    }
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return path ? `https://${host.toLowerCase()}/${path}` : null;
}

export class FileConfigStore implements ConfigStore {
  #dir: string;
  #file: string;
  #localFile: string;
  #group: GroupStore;
  #home: string;
  #bus: EventBus;
  /** The group store's settings and local.json (paths with `~`); local.json's text as last read or written. */
  #shared: Partial<Config> = {};
  #local: Partial<Config> = {};
  #lastText = '';
  #config: Config;
  /** Set while a file is broken (e.g. git conflict markers); cleared by the next good reload. */
  #problem?: string;
  /** A copy of the last config that loaded, in the state dir, to start from when a file is broken. */
  #lastGoodFile?: string;
  #watcher?: FSWatcher;
  #reloadTimer?: ReturnType<typeof setTimeout>;
  // ponytail: remotes cached for the process lifetime; restart shub after changing a remote.
  #remotes = new Map<string, string | null>();

  constructor(configDir: string, bus: EventBus, group: GroupStore, home = homedir(), lastGoodFile?: string) {
    this.#group = group;
    this.#dir = configDir;
    this.#lastGoodFile = lastGoodFile;
    this.#file = join(configDir, 'config.json');
    this.#localFile = join(configDir, 'local.json');
    this.#home = home;
    this.#bus = bus;
    mkdirSync(configDir, { recursive: true });
    try {
      this.#config = this.#load();
      this.#saveLastGood();
    } catch (err) {
      this.#problem = this.#describe(err);
      console.error(`shub: ${this.#problem}`);
      this.#config = this.#lastGood();
    }
  }

  #describe(err: unknown): string {
    return `config not readable (${(err as Error).message}); running on the last good config, changes are refused until the file is fixed`;
  }

  #lastGood(): Config {
    try {
      return normalize(JSON.parse(readFileSync(this.#lastGoodFile!, 'utf8')));
    } catch {
      return defaultConfig();
    }
  }

  #saveLastGood(): void {
    if (!this.#lastGoodFile) return;
    try {
      mkdirSync(dirname(this.#lastGoodFile), { recursive: true, mode: 0o700 });
      const tmp = `${this.#lastGoodFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.#config, null, 2) + '\n', { mode: 0o600 });
      renameSync(tmp, this.#lastGoodFile);
    } catch (err) {
      console.error('shub: could not save the last good config:', (err as Error).message);
    }
  }

  #readLocal(): Partial<Config> {
    let text: string;
    try {
      text = readFileSync(this.#localFile, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      text = '';
    }
    this.#lastText = text;
    return text.trim() ? JSON.parse(text) : {};
  }

  #load(): Config {
    // A broken config.json is not imported and not marked done, so fixing it and restarting still imports it.
    if (!this.#group.imported())
      this.#group.importConfig(existsSync(this.#file) ? JSON.parse(readFileSync(this.#file, 'utf8')) : {});
    this.#local = this.#readLocal();
    this.#shared = this.#group.config();
    return this.#merge();
  }

  #merge(): Config {
    return normalize(mapPaths({ ...this.#shared, ...this.#local }, (p) => expandHome(p, this.#home)));
  }

  #writeLocal(data: Partial<Config>): void {
    const text = JSON.stringify(data, null, 2) + '\n';
    if (text === this.#lastText) return;
    const tmp = `${this.#localFile}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o644 });
    renameSync(tmp, this.#localFile);
    this.#lastText = text;
  }

  /** Reload when local.json changes outside shub (an editor). */
  watch(): void {
    if (this.#watcher) return;
    this.#watcher = watch(this.#dir, (_event, name) => {
      if (name !== 'local.json') return;
      clearTimeout(this.#reloadTimer);
      this.#reloadTimer = setTimeout(() => this.reload(), 200);
    });
    this.#watcher.unref();
  }

  unwatch(): void {
    clearTimeout(this.#reloadTimer);
    this.#watcher?.close();
    this.#watcher = undefined;
  }

  /** Re-read the store and local.json; emits events only when the result differs. A broken file keeps the last good config. */
  reload(): void {
    const before = this.get();
    try {
      this.#config = this.#load();
      this.#problem = undefined;
      this.#saveLastGood();
    } catch (err) {
      this.#problem = this.#describe(err);
      console.error(`shub: ${this.#problem}`);
    }
    this.#emitChanges(before, this.get());
  }

  #emitChanges(before: Config, after: Config): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.#bus.emit({ type: 'config.changed' });
    if (JSON.stringify([before.projects, before.groups]) !== JSON.stringify([after.projects, after.groups]))
      this.#bus.emit({ type: 'projects.changed' });
  }

  get(): Config {
    const config = structuredClone(this.#config);
    if (this.#problem) config.problem = this.#problem;
    return config;
  }

  update(mutate: (config: Config) => void, _actor: string): Config {
    // Writing now would overwrite what is in the broken file (e.g. both sides of a git conflict).
    if (this.#problem) throw new HttpError(409, this.#problem);
    const next = structuredClone(this.#config);
    mutate(next);
    const normalized = normalize(next);
    const stored = mapPaths(normalized, (p) => contractHome(p, this.#home)) as Config;
    const localKeys = new Set<keyof Config>([...LOCAL_KEYS, ...(Object.keys(this.#local) as (keyof Config)[])]);
    const shared: Partial<Config> = {};
    const local: Partial<Config> = {};
    for (const key of Object.keys(stored) as (keyof Config)[]) {
      if (localKeys.has(key)) (local as Record<string, unknown>)[key] = stored[key];
      // Keys this machine overrides keep their shared value, so one machine never rewrites another's.
      else (shared as Record<string, unknown>)[key] = stored[key];
    }
    for (const key of localKeys) if (key in this.#shared) (shared as Record<string, unknown>)[key] = this.#shared[key];
    this.#group.setConfig(shared);
    if (Object.keys(local).length || existsSync(this.#localFile)) this.#writeLocal(local);
    this.#shared = this.#group.config();
    this.#local = local;
    const before = this.#config;
    this.#config = normalized;
    this.#saveLastGood();
    this.#bus.emit({ type: 'config.changed' });
    if (JSON.stringify([before.projects, before.groups]) !== JSON.stringify([normalized.projects, normalized.groups]))
      this.#bus.emit({ type: 'projects.changed' });
    return this.get();
  }

  project(id: string): Project | undefined {
    return this.get().projects.find((p) => p.id === id);
  }

  projectView(id: string): ProjectView | undefined {
    const project = this.project(id);
    return project && this.#view(project);
  }

  projectViews(): ProjectView[] {
    return this.get()
      .projects.sort((a, b) => a.order - b.order)
      .map((p) => this.#view(p));
  }

  resolveIcon(project: Pick<Project, 'path' | 'icon'>): ResolvedIcon {
    const icon = project.icon;
    if (icon.kind === 'symbol') return { kind: 'symbol', symbol: icon.symbol, color: icon.color };
    if (icon.kind === 'image') return { kind: 'image', path: icon.path };
    const remote = this.#remote(project.path);
    return iconForHost(remote && hostOfRemote(remote));
  }

  #remote(path: string): string | null {
    if (!this.#remotes.has(path)) this.#remotes.set(path, gitRemote(path));
    return this.#remotes.get(path)!;
  }

  #view(project: Project): ProjectView {
    const resolvedIcon = this.resolveIcon(project);
    // A shared config lists projects some machines do not have; they show greyed out, never get removed.
    const missing = !existsSync(project.path);
    const remote = this.#remote(project.path);
    const remoteUrl = remote && webUrlOfRemote(remote);
    return {
      ...project,
      resolvedIcon,
      accent: accentFor(resolvedIcon),
      ...(remoteUrl && { remoteUrl }),
      ...(missing && { missing }),
    };
  }
}

export function accentFor(icon: ResolvedIcon): string {
  const color = icon.kind === 'symbol' ? icon.color : undefined;
  // The status orange means "needs you"; a project may never wear it.
  if (!color || color.toLowerCase() === STATUS_ORANGE) return DEFAULT_ACCENT;
  return color;
}

export function create(ctx: Context, services: Services): { module: ShubModule; service: FileConfigStore } {
  const service = new FileConfigStore(
    ctx.paths.configDir,
    ctx.bus,
    services.group,
    homedir(),
    join(ctx.paths.stateDir, 'config.last-good.json'),
  );
  return { module: { name: 'config', start: () => service.watch(), stop: () => service.unwatch() }, service };
}
