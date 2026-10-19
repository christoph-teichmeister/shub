// config.json in configDir: projects, groups, themes, settings. No secrets live here.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Project, ProjectView, ResolvedIcon, ThemeDef } from '../../shared/api.ts';
import type { Context, EventBus } from '../context.ts';
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
  return config;
}

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
  #file: string;
  #bus: EventBus;
  #config: Config;
  // ponytail: remote icons cached for the process lifetime; restart shub after changing a remote.
  #remoteIcons = new Map<string, ResolvedIcon>();

  constructor(configDir: string, bus: EventBus) {
    this.#file = join(configDir, 'config.json');
    this.#bus = bus;
    mkdirSync(configDir, { recursive: true });
    this.#config = this.#load();
  }

  #load(): Config {
    try {
      return normalize(JSON.parse(readFileSync(this.#file, 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const fresh = defaultConfig();
      this.#write(fresh);
      return fresh;
    }
  }

  #write(config: Config): void {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
    renameSync(tmp, this.#file);
  }

  get(): Config {
    return structuredClone(this.#config);
  }

  update(mutate: (config: Config) => void, _actor: string): Config {
    const next = structuredClone(this.#config);
    mutate(next);
    const normalized = normalize(next);
    const projectsChanged =
      JSON.stringify([this.#config.projects, this.#config.groups]) !==
      JSON.stringify([normalized.projects, normalized.groups]);
    this.#write(normalized);
    this.#config = normalized;
    this.#bus.emit({ type: 'config.changed' });
    if (projectsChanged) this.#bus.emit({ type: 'projects.changed' });
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
    return { ...project, resolvedIcon, accent: accentFor(resolvedIcon) };
  }
}

export function accentFor(icon: ResolvedIcon): string {
  const color = icon.kind === 'symbol' ? icon.color : undefined;
  // The status orange means "needs you"; a project may never wear it.
  if (!color || color.toLowerCase() === STATUS_ORANGE) return DEFAULT_ACCENT;
  return color;
}

export function create(ctx: Context, _services: Services): { module: ShubModule; service: FileConfigStore } {
  return { module: { name: 'config' }, service: new FileConfigStore(ctx.paths.configDir, ctx.bus) };
}
