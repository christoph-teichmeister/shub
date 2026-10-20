// config.json in configDir: projects, groups, themes, settings. No secrets live here.
// It is meant to be shared between machines (dotfiles, Syncthing): paths under home are stored as `~/...`,
// and local.json next to it holds what stays on this machine; its keys win over config.json.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { Config, Project, ProjectView, ResolvedIcon, ThemeDef } from '../../shared/api.ts';
import type { Context, EventBus } from '../context.ts';
import { HttpError } from '../api/router.ts';
import type { ShubModule } from '../module.ts';
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
  delete config.problem;
  return config;
}

/** Keys that always go to local.json; any other key the user puts there stays local too. */
export const LOCAL_KEYS: (keyof Config)[] = ['updateChannel', 'updateMode'];

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

export class FileConfigStore implements ConfigStore {
  #dir: string;
  #file: string;
  #localFile: string;
  #home: string;
  #bus: EventBus;
  /** config.json and local.json as on disk (paths with `~`), and what was last read or written, to spot outside edits. */
  #shared: Partial<Config> = {};
  #local: Partial<Config> = {};
  #lastText = { shared: '', local: '' };
  #config: Config;
  /** Set while a file is broken (e.g. git conflict markers); cleared by the next good reload. */
  #problem?: string;
  /** A copy of the last config that loaded, in the state dir, to start from when a file is broken. */
  #lastGoodFile?: string;
  #watcher?: FSWatcher;
  #reloadTimer?: ReturnType<typeof setTimeout>;
  // ponytail: remote icons cached for the process lifetime; restart shub after changing a remote.
  #remoteIcons = new Map<string, ResolvedIcon>();

  constructor(configDir: string, bus: EventBus, home = homedir(), lastGoodFile?: string) {
    this.#dir = configDir;
    this.#lastGoodFile = lastGoodFile;
    this.#file = join(configDir, 'config.json');
    this.#localFile = join(configDir, 'local.json');
    this.#home = home;
    this.#bus = bus;
    mkdirSync(configDir, { recursive: true });
    if (!existsSync(this.#file)) this.#writeFile(this.#file, 'shared', defaultConfig());
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
    return `config not readable (${(err as Error).message}); running on the last good config, changes are refused until config.json and local.json are fixed`;
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

  #read(file: string, which: 'shared' | 'local'): Partial<Config> {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      text = '';
    }
    this.#lastText[which] = text;
    return text.trim() ? JSON.parse(text) : {};
  }

  #load(): Config {
    const shared = this.#read(this.#file, 'shared');
    const local = this.#read(this.#localFile, 'local');
    this.#shared = shared;
    this.#local = local;
    return this.#merge();
  }

  #merge(): Config {
    return normalize(mapPaths({ ...this.#shared, ...this.#local }, (p) => expandHome(p, this.#home)));
  }

  #writeFile(file: string, which: 'shared' | 'local', data: Partial<Config>): void {
    const text = JSON.stringify(data, null, 2) + '\n';
    if (text === this.#lastText[which]) return;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o644 });
    renameSync(tmp, file);
    this.#lastText[which] = text;
  }

  /** Reload when config.json or local.json changes outside shub (git pull, Syncthing, an editor). */
  watch(): void {
    if (this.#watcher) return;
    this.#watcher = watch(this.#dir, (_event, name) => {
      if (name !== 'config.json' && name !== 'local.json') return;
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

  /** Re-read both files; emits events only when the result differs. A broken file keeps the last good config. */
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
    this.#writeFile(this.#file, 'shared', shared);
    if (Object.keys(local).length || existsSync(this.#localFile)) this.#writeFile(this.#localFile, 'local', local);
    this.#shared = shared;
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
    let cached = this.#remoteIcons.get(project.path);
    if (!cached) {
      cached = remoteIcon(project.path);
      this.#remoteIcons.set(project.path, cached);
    }
    return cached;
  }

  #view(project: Project): ProjectView {
    const resolvedIcon = this.resolveIcon(project);
    // A shared config lists projects some machines do not have; they show greyed out, never get removed.
    const missing = !existsSync(project.path);
    return { ...project, resolvedIcon, accent: accentFor(resolvedIcon), ...(missing && { missing }) };
  }
}

export function accentFor(icon: ResolvedIcon): string {
  const color = icon.kind === 'symbol' ? icon.color : undefined;
  // The status orange means "needs you"; a project may never wear it.
  if (!color || color.toLowerCase() === STATUS_ORANGE) return DEFAULT_ACCENT;
  return color;
}

export function create(ctx: Context, _services: Services): { module: ShubModule; service: FileConfigStore } {
  const service = new FileConfigStore(
    ctx.paths.configDir,
    ctx.bus,
    homedir(),
    join(ctx.paths.stateDir, 'config.last-good.json'),
  );
  return { module: { name: 'config', start: () => service.watch(), stop: () => service.unwatch() }, service };
}
