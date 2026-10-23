// Reactive app state, loaded over HTTP and kept fresh by the /api/events WebSocket.
import type {
  Approval,
  ChildWorktree,
  Config,
  Device,
  DeviceLevel,
  PluginInfo,
  ProjectView,
  ServerEvent,
  Session,
  SessionStatus,
  StartSessionRequest,
  TerminalSettings,
  UpdateStatus,
  Usage,
} from '../../../../shared/api.ts';
import { API_VERSION, TERMINAL_SETTINGS_DEFAULTS, terminalSettingsError } from '../../../../shared/api.ts';
import { newlyMerged } from '../children.ts';
import { applyTheme, findTheme } from '../tokens/tokens.ts';
import { api, ApiError, wsTarget } from './api.ts';
import { href } from './router.svelte.ts';
import { toast, toastError } from './toasts.svelte.ts';
import { checkAppUpdate } from './loader.ts';

export const app = $state({
  ready: false,
  /** True after a 401: the login / pairing view (not built yet) takes over. */
  authRequired: false,
  connected: false,
  /** The shown machine did not answer at all (network error, not an HTTP status). */
  unreachable: false,
  /** API version of the shown machine when it differs from this app's (an older or newer shub there). */
  apiMismatch: null as number | null,
  config: null as Config | null,
  projects: [] as ProjectView[],
  sessions: [] as Session[],
  /** Worktrees sessions created (GET /api/worktrees/children). */
  children: [] as ChildWorktree[],
  /** A session started from a terminal (`shub claude`): Main jumps there when that terminal is the open tab. */
  jump: null as { from: string; to: Session } | null,
  approvals: [] as Approval[],
  plugins: [] as PluginInfo[],
  /** GET /api/usage: the 5h/7d subscription limits for the sidebar footer. */
  usage: {} as Usage,
  /** GET /api/updates: the Settings notice and the dot on the user chip. */
  update: null as UpdateStatus | null,
  /** GET /api/auth/me: `{caller, device, local}`; `name` if the server ever sends one. */
  me: null as {
    name?: string;
    caller?: { kind: string; id: string; level?: DeviceLevel };
    device?: Device | null;
    /** A trusted host or a Control phone: only here can devices be approved or raised. */
    local?: boolean;
  } | null,
  /** Bumped on devices.changed so Settings > Devices refetches. */
  devicesVersion: 0,
  /** Bumped per session on services.changed so views can refetch. */
  servicesVersion: {} as Record<string, number>,
  /** When this client saw a session's turn end (big: one of its worktrees got merged), for the village's confetti. */
  cheers: {} as Record<string, { at: number; big: boolean }>,
  /** Sessions on their way out: tab and sidebar row fade and say "Closing" until they are dropped. */
  closing: {} as Record<string, boolean>,
  /** Bumped whenever the theme is re-applied (canvas consumers re-read tokens). */
  themeVersion: 0,
  /** Version an update just installed: the update curtain shows while the page reloads into it. */
  reloadingTo: null as string | null,
});

/** Overlays that any view can open (search, drawer, shortcuts) and the phone layout switch. */
export const ui = $state({
  search: false,
  drawer: false,
  shortcuts: false,
  phone: matchMedia('(max-width: 699px)').matches,
});
matchMedia('(max-width: 699px)').addEventListener('change', (e) => (ui.phone = e.matches));

const DEVICE_TERMINAL_KEY = 'shub.terminal.device';
function readDeviceTerminal(): Partial<TerminalSettings> | null {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_TERMINAL_KEY) ?? 'null') as unknown;
    return v && !terminalSettingsError(v) ? (v as Partial<TerminalSettings>) : null;
  } catch {
    return null;
  }
}
/** This browser's own terminal settings over the shared ones (Settings > Terminal); null follows config.json. */
export const deviceTerminal = $state({ value: readDeviceTerminal() });
export function setDeviceTerminal(value: Partial<TerminalSettings> | null): void {
  deviceTerminal.value = value;
  try {
    if (value) localStorage.setItem(DEVICE_TERMINAL_KEY, JSON.stringify(value));
    else localStorage.removeItem(DEVICE_TERMINAL_KEY);
  } catch {
    // No storage (private window): keeps working until reload.
  }
}
/** The terminal look in effect here: defaults, then config.json, then this device's own settings. */
export function terminalSettings(): TerminalSettings {
  return { ...TERMINAL_SETTINGS_DEFAULTS, ...app.config?.terminal, ...deviceTerminal.value };
}

export const sessionHref = (s: Session) => (s.projectId ? href('p', s.projectId, s.id) : href('g'));

/** Starts a session; an approval answer only toasts (the approval dialog takes over). */
export async function startSession(req: StartSessionRequest): Promise<Session | undefined> {
  return added(await api<Session | { approval: Approval }>('sessionStart', { body: req }).catch(toastError));
}

/** A Claude session in the folder a terminal is in right now. */
export async function startClaudeHere(shellId: string): Promise<Session | undefined> {
  const res = api<Session | { approval: Approval }>('sessionClaudeHere', { params: { id: shellId } });
  return added(await res.catch(toastError));
}

function added(res: Session | { approval: Approval } | void): Session | undefined {
  if (!res) return;
  if ('approval' in res) {
    toast(`Waiting for your approval: ${res.approval.summary}`, 'needs-you');
    return;
  }
  if (!app.sessions.some((s) => s.id === res.id)) app.sessions.push(res);
  return res;
}

/** How long a closed session stays on screen fading out; matches --duration-slow. */
const CLOSE_FADE_MS = 400;

/** Closes a session; it shows as closing until session.closed drops it. */
export async function closeSession(id: string): Promise<void> {
  app.closing[id] = true;
  await api('sessionClose', { params: { id } }).catch((err: unknown) => {
    delete app.closing[id];
    toastError(err);
  });
}

/** Sends tmux keys: named keys (Escape, C-c, Up, Down, Tab, Enter) or literal text. */
export const sendKeys = (id: string, keys: string[]) =>
  api('sessionKeys', { params: { id }, body: { keys } }).catch(toastError);

/** Sends /compact; the sidebar menu and the village offer it from COMPACT_AT, on your turn. */
export const compact = (s: Session) => void sendKeys(s.id, ['/compact', 'Enter']);

export const needsYouCount = (sessions: Session[] = app.sessions): number =>
  sessions.filter((s) => s.status === 'needs-you').length;

export function sessionsOf(projectId: string | null): Session[] {
  // Only top-level sessions: panes (a second Claude, a terminal) live in their parent's control center.
  return app.sessions.filter((s) => s.projectId === projectId && !s.parentId);
}

export function childrenOf(sessionId: string): Session[] {
  return app.sessions.filter((s) => s.parentId === sessionId);
}

/** The session with its panes' attention folded in: a pane that needs you makes the sidebar row need you. */
export function rolledUp(s: Session): Session {
  const kids = childrenOf(s.id);
  const hot =
    kids.find((k) => k.status === 'needs-you') ??
    (s.status !== 'needs-you' && s.status !== 'working' ? kids.find((k) => k.status === 'working') : undefined);
  return hot ? { ...s, status: hot.status } : s;
}

function guard<T>(p: Promise<T>): Promise<T | undefined> {
  return p.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) app.authRequired = true;
    // The machine is off or out of reach: fetch failed, or `tailscale serve` answers 502/504 for a stopped shub.
    else if (err instanceof TypeError || (err instanceof ApiError && [502, 503, 504].includes(err.status))) {
      app.unreachable = true;
    } else console.warn(err);
    return undefined;
  });
}

function themeFromConfig(): void {
  const c = app.config;
  applyTheme(findTheme(c?.themes ?? [], c?.activeTheme));
  app.themeVersion++;
}

let shownProblem: string | undefined;
export async function loadConfig(): Promise<void> {
  const config = await guard(api<Config>('config'));
  if (config) app.config = config;
  themeFromConfig();
  if (config?.problem && config.problem !== shownProblem) toast(config.problem, 'error', 15_000);
  shownProblem = config?.problem;
}
export const loadProjects = async () => (app.projects = (await guard(api<ProjectView[]>('projects'))) ?? app.projects);
export const loadSessions = async () => (app.sessions = (await guard(api<Session[]>('sessions'))) ?? app.sessions);
export async function loadChildren(fetch = false): Promise<void> {
  const list = await guard(api<ChildWorktree[]>('worktreeChildren', { query: fetch ? { fetch: '1' } : undefined }));
  if (!list) return;
  for (const id of newlyMerged(app.children, list)) app.cheers[id] = { at: Date.now(), big: true };
  app.children = list;
}
export const loadApprovals = async () => (app.approvals = (await guard(api<Approval[]>('approvals'))) ?? app.approvals);
export const loadPlugins = async () => (app.plugins = (await guard(api<PluginInfo[]>('plugins'))) ?? app.plugins);
/** The server version this page's code came with; another one means an update ran, so reload to get its frontend. */
let loadedVersion: string | undefined;
let announced: string | undefined;
export async function loadUpdate(): Promise<void> {
  app.update = (await guard(api<UpdateStatus>('updates'))) ?? app.update;
  const current = app.update?.current;
  loadedVersion ??= current;
  if (current && current !== loadedVersion && !app.reloadingTo) {
    // Curtain first, so the reload reads as "updating" instead of a flicker; the new page fades it out.
    app.reloadingTo = current;
    try {
      sessionStorage.setItem('shub-updated', current);
    } catch {}
    // The app may run from the loader's cached bundle: let it fetch the new one before reloading.
    void checkAppUpdate([]).then(() => setTimeout(() => location.reload(), 900));
  }
  const latest = app.update?.mode === 'ask' ? app.update.latest : undefined;
  if (latest && latest !== announced)
    toast(`shub ${latest} is available. Install it in Settings > Updates.`, 'needs-you', 15_000);
  announced = latest ?? announced;
}

export async function loadAll(): Promise<void> {
  await Promise.all([
    loadConfig(),
    loadProjects(),
    loadSessions(),
    loadChildren(),
    loadApprovals(),
    loadPlugins(),
    loadUpdate(),
    guard(api<Usage>('usage')).then((u) => (app.usage = u ?? {})),
    guard(api<{ name?: string }>('me')).then((me) => (app.me = me ?? null)),
    guard(api<{ apiVersion: number }>('health')).then((h) => {
      app.apiMismatch = h && h.apiVersion !== API_VERSION ? h.apiVersion : null;
    }),
  ]);
  app.ready = true;
}

function upsert<T extends { id: string }>(list: T[], item: T): void {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

function setStatus(sessionId: string, status: SessionStatus, statusSince?: string): void {
  const s = app.sessions.find((x) => x.id === sessionId);
  if (!s || s.status === status) return;
  s.status = status;
  // Older servers send no statusSince: the change happened just now.
  s.statusSince = statusSince ?? new Date().toISOString();
  if (status === 'your-turn') app.cheers[sessionId] = { at: Date.now(), big: false };
}

export function handleEvent(e: ServerEvent): void {
  switch (e.type) {
    case 'session.started':
      if (e.from) app.jump = { from: e.from, to: e.session };
      return upsert(app.sessions, e.session);
    case 'session.updated':
      return upsert(app.sessions, e.session);
    case 'session.status':
      return setStatus(e.sessionId, e.status, e.statusSince);
    case 'session.closed':
      void loadChildren();
      // Also for closes from another device: let the fade-out play before the session goes.
      app.closing[e.sessionId] = true;
      setTimeout(() => {
        app.sessions = app.sessions.filter((s) => s.id !== e.sessionId);
        delete app.closing[e.sessionId];
      }, CLOSE_FADE_MS);
      return;
    case 'projects.changed':
      void loadProjects();
      return;
    case 'config.changed':
      void loadConfig();
      void loadProjects();
      return;
    case 'approval.created':
    case 'approval.decided':
      return upsert(app.approvals, e.approval);
    case 'services.changed':
      app.servicesVersion[e.sessionId] = (app.servicesVersion[e.sessionId] ?? 0) + 1;
      return;
    case 'usage.updated':
      app.usage = e.usage;
      return;
    case 'worktrees.changed':
      void loadChildren();
      return;
    case 'plugins.changed':
      void loadPlugins();
      return;
    case 'updates.changed':
      void loadUpdate();
      return;
    case 'devices.changed':
      app.devicesVersion++;
      if (app.me?.local) void announcePending();
      return;
    default:
      return; // hello, activity, plugin.action: nothing to keep in state yet
  }
}

const announcedDevices = new Set<string>();

/** On the machine itself: say once per device when a phone waits for approval. */
async function announcePending(): Promise<void> {
  const list = await api<Device[]>('devices').catch(() => []);
  for (const d of list) {
    if (d.state !== 'pending' || announcedDevices.has(d.id)) continue;
    announcedDevices.add(d.id);
    toast(`${d.name} wants to pair. Approve it in Settings > Devices.`, 'neutral', 10_000);
  }
}

/** Connects /api/events and reconnects with backoff (1 s .. 30 s). Reloads everything after a reconnect. */
export function connectEvents(): () => void {
  let ws: WebSocket | null = null;
  let delay = 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everOpen = false;

  const open = async () => {
    const { url, protocols } = await wsTarget('/api/events');
    if (stopped) return;
    ws = new WebSocket(url, protocols);
    ws.onopen = () => {
      app.connected = true;
      delay = 1000;
      if (everOpen) void loadAll();
      everOpen = true;
    };
    ws.onmessage = (msg) => {
      try {
        handleEvent(JSON.parse(String(msg.data)) as ServerEvent);
      } catch (err) {
        console.warn('Bad event', err);
      }
    };
    ws.onclose = () => {
      app.connected = false;
      if (stopped || app.authRequired) return;
      timer = setTimeout(() => void open(), delay);
      delay = Math.min(delay * 2, 30_000);
    };
  };
  void open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
