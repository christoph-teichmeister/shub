// Reactive app state, loaded over HTTP and kept fresh by the /api/events WebSocket.
import type {
  Approval,
  Config,
  Device,
  PluginInfo,
  ProjectView,
  ServerEvent,
  Session,
  SessionStatus,
  StartSessionRequest,
} from '../../../../shared/api.ts';
import { applyTheme, findTheme } from '../tokens/tokens.ts';
import { api, ApiError, wsUrl } from './api.ts';
import { href } from './router.svelte.ts';
import { toast, toastError } from './toasts.svelte.ts';

export const app = $state({
  ready: false,
  /** True after a 401: the login / pairing view (not built yet) takes over. */
  authRequired: false,
  connected: false,
  config: null as Config | null,
  projects: [] as ProjectView[],
  sessions: [] as Session[],
  approvals: [] as Approval[],
  plugins: [] as PluginInfo[],
  /** GET /api/auth/me: `{caller, device}`; `name` if the server ever sends one. */
  me: null as { name?: string; caller?: { kind: string; id: string }; device?: Device | null } | null,
  /** Bumped per session on services.changed so views can refetch. */
  servicesVersion: {} as Record<string, number>,
  /** Bumped whenever the theme is re-applied (canvas consumers re-read tokens). */
  themeVersion: 0,
});

/** Overlays that any view can open (search, drawer, shortcuts) and the phone layout switch. */
export const ui = $state({
  search: false,
  drawer: false,
  shortcuts: false,
  phone: matchMedia('(max-width: 699px)').matches,
});
matchMedia('(max-width: 699px)').addEventListener('change', (e) => (ui.phone = e.matches));

export const sessionHref = (s: Session) => (s.projectId ? href('p', s.projectId, s.id) : href('g'));

/** Starts a session; an approval answer only toasts (the approval dialog takes over). */
export async function startSession(req: StartSessionRequest): Promise<Session | undefined> {
  const res = await api<Session | { approval: Approval }>('sessionStart', { body: req }).catch(toastError);
  if (!res) return;
  if ('approval' in res) {
    toast(`Waiting for your approval: ${res.approval.summary}`, 'needs-you');
    return;
  }
  if (!app.sessions.some((s) => s.id === res.id)) app.sessions.push(res);
  return res;
}

/** Sends tmux keys: named keys (Escape, C-c, Up, Down, Tab, Enter) or literal text. */
export const sendKeys = (id: string, keys: string[]) =>
  api('sessionKeys', { params: { id }, body: { keys } }).catch(toastError);

export const needsYouCount = (sessions: Session[] = app.sessions): number =>
  sessions.filter((s) => s.status === 'needs-you').length;

export function sessionsOf(projectId: string | null): Session[] {
  return app.sessions.filter((s) => s.projectId === projectId && s.kind !== 'shell');
}

export function shellsOf(sessionId: string): Session[] {
  return app.sessions.filter((s) => s.kind === 'shell' && s.parentId === sessionId);
}

function guard<T>(p: Promise<T>): Promise<T | undefined> {
  return p.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) app.authRequired = true;
    else console.warn(err);
    return undefined;
  });
}

function themeFromConfig(): void {
  const c = app.config;
  applyTheme(findTheme(c?.themes ?? [], c?.activeTheme));
  app.themeVersion++;
}

export async function loadConfig(): Promise<void> {
  const config = await guard(api<Config>('config'));
  if (config) app.config = config;
  themeFromConfig();
}
export const loadProjects = async () => (app.projects = (await guard(api<ProjectView[]>('projects'))) ?? app.projects);
export const loadSessions = async () => (app.sessions = (await guard(api<Session[]>('sessions'))) ?? app.sessions);
export const loadApprovals = async () => (app.approvals = (await guard(api<Approval[]>('approvals'))) ?? app.approvals);
export const loadPlugins = async () => (app.plugins = (await guard(api<PluginInfo[]>('plugins'))) ?? app.plugins);

export async function loadAll(): Promise<void> {
  await Promise.all([
    loadConfig(),
    loadProjects(),
    loadSessions(),
    loadApprovals(),
    loadPlugins(),
    guard(api<{ name?: string }>('me')).then((me) => (app.me = me ?? null)),
  ]);
  app.ready = true;
}

function upsert<T extends { id: string }>(list: T[], item: T): void {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

function setStatus(sessionId: string, status: SessionStatus): void {
  const s = app.sessions.find((x) => x.id === sessionId);
  if (s) s.status = status;
}

export function handleEvent(e: ServerEvent): void {
  switch (e.type) {
    case 'session.started':
    case 'session.updated':
      return upsert(app.sessions, e.session);
    case 'session.status':
      return setStatus(e.sessionId, e.status);
    case 'session.closed':
      app.sessions = app.sessions.filter((s) => s.id !== e.sessionId);
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
    case 'plugins.changed':
      void loadPlugins();
      return;
    default:
      return; // hello, activity, plugin.action: nothing to keep in state yet
  }
}

/** Connects /api/events and reconnects with backoff (1 s .. 30 s). Reloads everything after a reconnect. */
export function connectEvents(): () => void {
  let ws: WebSocket | null = null;
  let delay = 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everOpen = false;

  const open = () => {
    ws = new WebSocket(wsUrl('/api/events'));
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
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 30_000);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
