// The one contract between the shub server, the web app, the `shub` CLI and plugins.
// Server modules implement it, everyone else only talks to it over HTTP/WebSocket.
// Bump API_VERSION on any breaking change and note it in docs/API.md.

export const API_VERSION = 1;

// ---------- projects and config ----------

export type Visibility = 'pinned' | 'dormant';

export type ProjectIcon =
  | { kind: 'auto' } // detected from the git remote at read time
  | { kind: 'symbol'; symbol: string; color: string }
  | { kind: 'image'; path: string }; // data:image/... or https:// URL

export type ButtonAsk = 'nothing' | 'text' | 'number' | 'pick-worktree';

export interface ButtonDef {
  id: string;
  label: string;
  /** Slash command of a discovered skill, e.g. "/worktree-start"; or empty for a free prompt button. */
  skill?: string;
  /** Free prompt; `{input}` is replaced with what the button asks for. */
  prompt?: string;
  ask: ButtonAsk;
  confirm: boolean;
  /** Claude permission mode for sessions started by this button. Default: "default". */
  permissionMode?: PermissionMode;
  /** Locked buttons may never run in a prompt-skipping mode (e.g. reviews of other people's code). */
  lockDefaultMode?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  group: string;
  visibility: Visibility;
  order: number;
  icon: ProjectIcon;
  buttons: ButtonDef[];
  /** `path` is the main checkout: sessions may not change it, shub fetches and fast-forwards it. */
  mainCheckout?: MainCheckout;
}

export interface MainCheckout {
  branch: string;
  /** Fetch (and fast-forward when clean) every n minutes; 0 = never. */
  updateMinutes: number;
}

export interface ResolvedIcon {
  kind: 'github' | 'gitlab' | 'symbol' | 'image' | 'none';
  symbol?: string;
  color?: string;
  path?: string;
  host?: string;
}

export interface ProjectView extends Project {
  resolvedIcon: ResolvedIcon;
  /** Underscore / cursor colour; project colour, default pink for auto icons. Never the status orange. */
  accent: string;
  /** The folder does not exist on this machine (config.json is shared between machines). */
  missing?: boolean;
  /** Browser URL of the `origin` remote (GitHub, GitLab, ...), when there is one. */
  remoteUrl?: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  base?: string; // id of a built-in theme this one extends
  builtIn: boolean;
  /** Token name -> CSS colour. Only tokens listed in web/src/lib/tokens/tokens.ts are valid. */
  tokens: Record<string, string>;
}

export interface Config {
  version: 1;
  groups: string[];
  projects: Project[];
  themes: ThemeDef[];
  activeTheme: string;
  notifications: {
    desktopNeedsYou: boolean;
    pushNeedsYou: boolean;
    pushYourTurn: boolean;
    noPushWhileDesktopFocused: boolean;
  };
  plugins: {
    name: string;
    enabled: boolean;
    grantedRights: Right[];
    /** Extra environment for the plugin process, e.g. KB_CARD_URL. shub's own environment wins. */
    env?: Record<string, string>;
  }[];
  /** Sidebar shows an "Active" group on top: every project with a session, kept 10 minutes after its last one. */
  activeGroup?: boolean;
  /** Terminal look; a missing field keeps its default (TERMINAL_SETTINGS_DEFAULTS). */
  terminal?: Partial<TerminalSettings>;
  /** Mode for sessions the user starts and the global Claude; a button's own mode wins. Default: "default". */
  defaultPermissionMode: LaunchPermissionMode;
  /** Release channel for updates. Absent: "beta" while a beta runs, else "stable". */
  updateChannel?: UpdateChannel;
  /** What happens when a newer release is out: "auto" installs it, "ask" shows it in
   *  Settings, "off" stops the hourly check ("Check now" still works). Absent: "ask". */
  updateMode?: UpdateMode;
  /** https address the phone reaches shub at (the `tailscale serve` name); local.json. SHUB_PUBLIC_URL wins. */
  publicUrl?: string;
  /** Never stored: why config.json or local.json could not be read. shub then runs on the last good config and
   *  refuses changes until the file is fixed (it reloads on save). */
  problem?: string;
}

export type TerminalCursorStyle = 'underline' | 'block' | 'bar';
export interface TerminalSettings {
  /** CSS font-family list; fonts missing on a device fall back to the next one. */
  fontFamily: string;
  /** Used where none of `fontFamily` is installed (another machine, the phone); appended after it. */
  fallbackFont: string;
  /** px; split panes and the phone use one px less. */
  fontSize: number;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Extra px between letters. */
  letterSpacing: number;
  fontWeight: 'normal' | 'bold';
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  /** Lines kept above the screen. */
  scrollback: number;
}
export const TERMINAL_SETTINGS_DEFAULTS: TerminalSettings = {
  fontFamily: "'JetBrains Mono'",
  fallbackFont: 'ui-monospace, monospace',
  fontSize: 13,
  lineHeight: 1,
  letterSpacing: 0,
  fontWeight: 'normal',
  cursorStyle: 'underline',
  cursorBlink: true,
  scrollback: 5000,
};

/** Why a terminal settings patch is invalid, or null. Unknown keys and out-of-range values are invalid (a bad font
 *  size would make every terminal unusable); null resets a field. */
export function terminalSettingsError(t: unknown): string | null {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return 'terminal must be an object';
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && v >= min && v <= max;
  const font = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[;{}<>]/.test(v);
  const valid: Record<keyof TerminalSettings, (v: unknown) => boolean> = {
    fontFamily: font,
    fallbackFont: font,
    fontSize: (v) => num(v, 6, 40),
    lineHeight: (v) => num(v, 1, 2),
    letterSpacing: (v) => num(v, -2, 10),
    fontWeight: (v) => v === 'normal' || v === 'bold',
    cursorStyle: (v) => v === 'underline' || v === 'block' || v === 'bar',
    cursorBlink: (v) => typeof v === 'boolean',
    scrollback: (v) => Number.isInteger(v) && num(v, 0, 100_000),
  };
  for (const [k, v] of Object.entries(t)) {
    if (!(k in valid) || (v !== null && !valid[k as keyof TerminalSettings](v))) return `terminal.${k} is invalid`;
  }
  return null;
}

// ---------- sessions ----------

export type SessionKind = 'claude' | 'shell' | 'global';
/** "new": Claude is up but no prompt was sent yet. "waiting": parked until something outside happens (`waitingFor`). */
export type SessionStatus =
  | 'new'
  | 'working'
  | 'needs-you'
  | 'your-turn'
  | 'waiting'
  | 'paused'
  /** Queued by a restore after a reboot; resumes shortly. */
  | 'starting'
  | 'exited';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';
export const PROMPT_SKIPPING_MODES: PermissionMode[] = ['auto', 'bypassPermissions'];
export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
/** "inherit" passes no --permission-mode flag: Claude uses the user's own settings. */
export type LaunchPermissionMode = PermissionMode | 'inherit';

export interface SessionLink {
  /** Who added it, e.g. "plugin:kb-board". */
  source: string;
  label: string;
  url: string;
}

export interface Session {
  id: string; // shub id, also used in the tmux session name
  kind: SessionKind;
  projectId: string | null; // null for the global Claude
  name: string;
  cwd: string;
  status: SessionStatus;
  /** Claude session UUID (passed as --session-id), for resume. Null for shells. */
  claudeSessionId: string | null;
  /** "inherit" until the first hook reports the mode Claude actually runs in. */
  permissionMode: LaunchPermissionMode;
  /** "chris" or "session:<id>" or "plugin:<name>". */
  startedBy: string;
  /** Parent shell/claude session for plain terminals. */
  parentId: string | null;
  links: SessionLink[];
  createdAt: string;
  lastActivityAt: string;
  /** Permission question waiting on the phone, if any. */
  pendingPermission?: { tool: string; summary: string } | null;
  /** What the session waits for, e.g. "Kai's answer on the MR". While set, a finished turn lands on "waiting"
   *  instead of "your-turn"; cleared by the user or by the session (`shub session ready`). */
  waitingFor?: string | null;
  /** Background check while waiting: a small model reads (never writes) whether it happened, every few minutes. */
  waitCheck?: WaitCheck | null;
  /** Place in its project's list the user dragged it to; null follows the default order. */
  position?: number | null;
  /** Shell commands Claude asked you to run at the end of its turn (status needs-you until run or dismissed). */
  pendingCommands?: HandedCommand[] | null;
  /** Background shells (servers, tests) still running after Claude's turn ended. */
  shells?: number;
}

/** A command Claude handed over; `session` or `cwd` (absolute) name where it belongs, none = the writing session. */
export interface HandedCommand {
  command: string;
  session?: string;
  cwd?: string;
}

export interface WaitCheck {
  /** What to look at and what counts as done, in the user's words. */
  prompt: string;
  everyMinutes: number;
  checkedAt: string | null;
  /** The last answer, e.g. "NOT YET: no new comment from Kai". */
  last: string | null;
}

export interface StartSessionRequest {
  projectId: string | null;
  kind: SessionKind;
  name?: string;
  /** Exactly one of buttonId (+ input) or prompt, or neither for an empty session. */
  buttonId?: string;
  input?: string;
  prompt?: string;
  parentId?: string; // kind "shell": its panel; a shell without one is a tab of its own and needs a cwd
  /** Defaults to the parent's cwd, else the project folder. Without a parent it must be one of the project's worktrees. */
  cwd?: string;
  /** kind "claude" only: reopen this old Claude conversation (from oldSessions) with `--resume`. */
  resumeClaudeSessionId?: string;
}

/** First-run suggestion from ~/.claude/projects (GET /api/projects/import adds resolvedIcon). */
export interface ImportCandidate {
  path: string;
  name: string;
  sessions: number;
  lastUsedAt: string;
  suggested: Visibility;
}

export interface Worktree {
  path: string;
  branch: string; // short name, "" when detached
}

/** One state per worktree; see `classify` in server/projects/worktrees.ts for the order. */
export type WorktreeState =
  | 'active' // a shub session runs in it
  | 'folder-gone' // prunable
  | 'locked'
  | 'dirty' // uncommitted or untracked files
  | 'merged' // HEAD is contained in origin/develop, main or master
  | 'remote-gone' // the branch's upstream was deleted, usually after a squash merge
  | 'not-pushed' // commits on no remote
  | 'detached'
  | 'open'; // clean, pushed, not merged yet

/** GET /api/worktrees: a project's worktrees for the cleanup section (main checkout left out). */
export interface WorktreeInfo {
  projectId: string;
  path: string;
  name: string; // folder name
  branch: string; // "" when detached
  state: WorktreeState;
  lastCommitAt: string | null; // ISO date of HEAD's commit
}

export interface OldSession {
  claudeSessionId: string;
  projectId: string;
  firstPrompt: string;
  turns: number;
  lastAt: string;
}

// ---------- permissions, approvals, activity ----------

export type Right =
  | 'read'
  | 'projects.write'
  | 'sessions.start' // free prompt: asks unless the client is global Claude... see docs/SECURITY.md
  | 'sessions.start.button'
  | 'sessions.link'
  | 'buttons.write'
  | 'ui.contribute';

export const RIGHTS: Right[] = [
  'read',
  'projects.write',
  'sessions.start',
  'sessions.start.button',
  'sessions.link',
  'buttons.write',
  'ui.contribute',
];

export type ClientKind = 'user' | 'global-claude' | 'session' | 'spawned-session' | 'plugin' | 'cli';

export type Decision = { outcome: 'allow' } | { outcome: 'ask'; reason: string } | { outcome: 'deny'; reason: string };

export interface Approval {
  id: string;
  requestedBy: string;
  action: 'session.start' | 'buttons.write' | 'projects.write';
  projectId: string | null;
  summary: string;
  /** Full prompt or a diff of button prompts; shown verbatim. */
  detail: string;
  createdAt: string;
  state: 'pending' | 'approved' | 'rejected';
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  undo?: { kind: string; payload: unknown } | null;
}

// ---------- docker ----------

export interface ServiceContainer {
  id: string;
  name: string; // compose service name
  project: string; // compose project
  workingDir: string;
  image: string;
  kind: 'python' | 'postgres' | 'redis' | 'rabbitmq' | 'celery' | 'node' | 'nginx' | 'other';
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'created' | 'dead';
  status: string; // human text from Docker, e.g. "Up 41 minutes (healthy)"
  ports: { host: number; container: number }[];
  cpuPercent?: number;
  memBytes?: number;
}

export interface LogLine {
  stream: 'stdout' | 'stderr';
  /** ISO timestamp from Docker, or null when the line had none. */
  at: string | null;
  text: string;
}

export interface ServiceInspect {
  env: { key: string; value: string; masked: boolean }[];
  mounts: { type: string; source: string; destination: string; rw: boolean }[];
  ports: { container: string; host: string[] }[];
}

// ---------- auth and devices ----------

/**
 * What a paired phone may do (docs/SECURITY.md): view = read + push, prompts = also answer approvals,
 * permission questions and Run chips, control = everything. Desktop logins with the access token are control.
 */
export type DeviceLevel = 'view' | 'prompts' | 'control';
export const DEVICE_LEVELS: DeviceLevel[] = ['view', 'prompts', 'control'];

export interface Device {
  id: string;
  name: string;
  kind: 'desktop' | 'phone';
  pairedAt: string;
  lastSeenAt: string;
  push: boolean;
  level: DeviceLevel;
  /** pending: paired but not yet approved on the machine; it cannot sign in. */
  state: 'pending' | 'active';
}

/**
 * Lowest level a device needs per route. Unlisted routes: GET needs view, everything else control.
 * The server gate (server/auth/levels.ts) enforces it; the web app only uses it to hide what would fail.
 */
export const ROUTE_LEVELS: Partial<Record<keyof typeof ROUTES, DeviceLevel>> = {
  logout: 'view',
  pushSubscribe: 'view',
  pushTest: 'view',
  approvalDecide: 'prompts',
  sessionCommand: 'prompts', // by index only: runs a command Claude handed over, never text from the phone
  sessionKeys: 'prompts', // prompts: named keys and single digits only, see sessions
};

// ---------- plugins ----------

export interface PluginManifest {
  name: string; // [a-z0-9-]+
  version: string;
  description?: string;
  /** Command run in the plugin folder, e.g. ["uv", "run", "plugin.py"]. */
  start: string[];
  rights: Right[];
  contributes?: {
    sidebarSections?: { id: string; title: string }[];
    sessionMenuActions?: { id: string; label: string }[];
    settingsActions?: { id: string; label: string }[];
  };
}

/** What a plugin pushes for one of its sidebar sections (PUT /api/plugins/:name/sections/:id). */
export interface SidebarSectionContent {
  badge?: { text: string; tone: 'needs-you' | 'working' | 'neutral' } | null;
  /** An entry may carry both `url` and `action` (a declared action id; clicking sends its `entryId`). */
  entries: {
    id: string;
    title: string;
    subtitle?: string;
    tone?: 'needs-you' | 'working' | 'done' | 'neutral';
    url?: string;
    action?: string;
  }[];
}

export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  source: string; // git url
  enabled: boolean;
  running: boolean;
  requestedRights: Right[];
  grantedRights: Right[];
  sections: { id: string; title: string; content: SidebarSectionContent | null }[];
  sessionMenuActions: { id: string; label: string }[];
  settingsActions: { id: string; label: string }[];
}

// ---------- skills ----------

export interface SkillInfo {
  name: string; // without slash
  description: string;
  scope: 'project' | 'global' | 'plugin';
  path: string;
}

// ---------- phone setup ----------

/** GET /api/phone-setup: what the Settings wizard checks before pairing a phone. */
export interface PhoneSetup {
  tailscale: {
    /** The `tailscale` CLI exists. */
    installed: boolean;
    /** Logged in and connected. */
    running: boolean;
    /** This machine's tailnet name, e.g. "pc.tail1234.ts.net". */
    dnsName?: string;
    /** HTTPS certificates are on in the tailnet (needed for `tailscale serve` over https). */
    https: boolean;
    /** Online phones (iOS/Android) in the tailnet. */
    phones: string[];
    /** Phones known to the tailnet but offline (Tailscale app closed or VPN off). */
    offlinePhones: string[];
    /** `tailscale serve` forwards to shub's port. */
    served: boolean;
  };
  /** The address the phone uses, and where it comes from ("env" = SHUB_PUBLIC_URL, fixed). */
  publicUrl?: string;
  publicUrlSource?: 'env' | 'config';
}

// ---------- updates ----------

export type UpdateChannel = 'stable' | 'beta';
export type UpdateMode = 'auto' | 'ask' | 'off';

/**
 * GET /api/updates. Installing and rolling back are done by the shub launcher (launcher/), which verifies the
 * release, switches versions and restarts shub; a version that does not come up is rolled back automatically.
 */
export interface UpdateStatus {
  /** The version that is running. */
  current: string;
  channel: UpdateChannel;
  mode: UpdateMode;
  /** "git": shub runs from a checkout without the launcher, so git manages updates and the update routes refuse. */
  managedBy: 'launcher' | 'git';
  /** Newest release on the channel, only when it is newer than `current`. */
  latest?: string;
  /** Release notes (Markdown) of the releases after `current` up to `latest`. */
  changelog?: string;
  checkedAt: string | null;
  /** Why the last check failed. */
  checkError?: string;
  /** The version "roll back" switches to. */
  previous?: string;
  /** The launcher's last install, update or rollback, e.g. an automatic rollback and its reason. */
  last?: { at: string; from: string | null; to: string; ok: boolean; message: string };
}

/** One release of GET /api/updates/changelog. */
export interface ReleaseNotes {
  version: string;
  publishedAt: string;
  /** Markdown. */
  notes: string;
}

// ---------- HTTP routes ----------
// All under /api, JSON in and out, auth by cookie (browser) or `Authorization: Bearer <token>`.

export const ROUTES = {
  health: 'GET /api/health',
  login: 'POST /api/auth/login', // { token } -> sets cookie
  logout: 'POST /api/auth/logout',
  me: 'GET /api/auth/me',
  pairingStart: 'POST /api/auth/pairing', // -> { code, url, qrSvg, expiresAt }
  pairingRedeem: 'POST /api/auth/pairing/redeem', // { code, deviceName, publicKey: JWK } -> { device } (pending)
  authChallenge: 'POST /api/auth/challenge', // { deviceId } -> { nonce }; 409 while the device is pending
  authSession: 'POST /api/auth/session', // { deviceId, nonce, signature } -> { token, expiresAt }
  devices: 'GET /api/devices',
  deviceUpdate: 'PATCH /api/devices/:id', // { name } rename, { level } only from the machine itself -> Device
  deviceApprove: 'POST /api/devices/:id/approve', // only from the machine itself -> Device
  deviceDelete: 'DELETE /api/devices/:id',
  rotateToken: 'POST /api/auth/rotate',

  config: 'GET /api/config',
  projects: 'GET /api/projects',
  projectCreate: 'POST /api/projects',
  projectUpdate: 'PATCH /api/projects/:id',
  projectDelete: 'DELETE /api/projects/:id', // user only, never touches the folder
  projectsReorder: 'POST /api/projects/reorder',
  importCandidates: 'GET /api/projects/import', // first run suggestions
  folders: 'GET /api/folders', // ?path= (default home) -> { path, parent, folders }, user only
  themes: 'PUT /api/themes/:id',
  settings: 'PATCH /api/settings',

  skills: 'GET /api/projects/:id/skills',
  projectWorktrees: 'GET /api/projects/:id/worktrees', // -> Worktree[]
  worktrees: 'GET /api/worktrees', // ?projectId= one project, ?fetch=1 fetches first -> WorktreeInfo[] (every project without projectId)
  worktreeRemove: 'POST /api/worktrees/remove', // { projectId, path } -> { branchDeleted } (user only, plain git)
  worktreePrune: 'POST /api/worktrees/prune', // { projectId } -> { ok } (user only)

  sessions: 'GET /api/sessions',
  sessionStart: 'POST /api/sessions', // StartSessionRequest -> Session | { approval: Approval }
  sessionUpdate: 'PATCH /api/sessions/:id', // { name } rename, { waitingFor: string | null, waitCheck?, waitEveryMinutes? } wait / stop
  sessionsReorder: 'POST /api/sessions/reorder', // { positions: { [id]: number | null } } -> Session[], user only
  sessionClose: 'DELETE /api/sessions/:id',
  sessionPause: 'POST /api/sessions/:id/pause',
  sessionResume: 'POST /api/sessions/:id/resume',
  sessionCommand: 'POST /api/sessions/:id/command', // { index, action: 'run' | 'dismiss', enter? } pendingCommands
  sessionKeys: 'POST /api/sessions/:id/keys', // { keys: "1" | "Escape" | ... } phone quick keys
  sessionPaste: 'POST /api/sessions/:id/paste', // text or multipart image -> path inserted
  sessionLink: 'POST /api/sessions/:id/links', // SessionLink
  oldSessions: 'GET /api/projects/:id/old-sessions',
  restorable: 'GET /api/sessions/restorable', // after reboot
  restore: 'POST /api/sessions/restore',

  approvals: 'GET /api/approvals',
  approvalDecide: 'POST /api/approvals/:id', // { approve: boolean } user only
  activity: 'GET /api/activity',
  undo: 'POST /api/activity/:id/undo',

  services: 'GET /api/sessions/:id/services',
  serviceAction: 'POST /api/services/:containerId/:action', // start | stop | restart
  serviceLogs: 'GET /api/services/:containerId/logs',
  serviceInspect: 'GET /api/services/:containerId/inspect',

  hook: 'POST /api/hooks/:event', // Claude Code hooks, auth by per-session token
  guard: 'POST /api/guard', // PreToolUse hook: deny changes to a protected main checkout, per-session token

  plugins: 'GET /api/plugins',
  pluginUpdate: 'PATCH /api/plugins/:name', // enable/disable, grant rights (user only)
  pluginSection: 'PUT /api/plugins/:name/sections/:sectionId', // SidebarSectionContent
  pluginAction: 'POST /api/plugins/:name/actions/:actionId', // user clicked an action -> forwarded as event
  pluginLogs: 'GET /api/plugins/:name/logs', // -> { lines: string[] } user only
  pluginRemove: 'DELETE /api/plugins/:name', // user only, deletes the plugin folder

  pushKey: 'GET /api/push/key',
  pushSubscribe: 'POST /api/push/subscribe',
  pushTest: 'POST /api/push/test',

  eventsStream: 'GET /api/events/stream', // Server-Sent Events twin of the /api/events WebSocket

  phoneSetup: 'GET /api/phone-setup', // -> PhoneSetup, user only
  phoneSetupServe: 'POST /api/phone-setup/serve', // runs `tailscale serve` and stores publicUrl -> PhoneSetup, user only

  updates: 'GET /api/updates', // -> UpdateStatus
  updateCheck: 'POST /api/updates/check', // -> UpdateStatus, user only
  updateInstall: 'POST /api/updates/install', // { version? } -> { ok, version }; the launcher restarts shub. User only
  updateRollback: 'POST /api/updates/rollback', // -> { ok, version }, user only
  updateChannel: 'PATCH /api/updates/channel', // { channel } -> UpdateStatus, user only
  updateMode: 'PATCH /api/updates/mode', // { mode } -> UpdateStatus, user only
  changelog: 'GET /api/updates/changelog', // -> ReleaseNotes[], newest first, up to the running version
} as const;

// ---------- WebSockets ----------
// /api/events          JSON ServerEvent stream for every authenticated client.
// /api/terminals/:id   raw PTY bytes both ways; text frames starting with "\u0000" are control JSON (TerminalControl).

export type ServerEvent =
  | { type: 'hello'; apiVersion: number }
  | { type: 'session.started'; session: Session }
  | { type: 'session.updated'; session: Session }
  | { type: 'session.status'; sessionId: string; status: SessionStatus }
  | { type: 'session.closed'; sessionId: string }
  | { type: 'projects.changed' }
  | { type: 'config.changed' }
  | { type: 'approval.created'; approval: Approval }
  | { type: 'approval.decided'; approval: Approval }
  | { type: 'activity'; entry: ActivityEntry }
  | { type: 'services.changed'; sessionId: string }
  | { type: 'plugins.changed' }
  | { type: 'updates.changed' }
  | { type: 'devices.changed' }
  | {
      type: 'plugin.action';
      plugin: string;
      actionId: string;
      /** entryId: the sidebar section entry whose action was clicked. */
      context: { sessionId?: string; projectId?: string; entryId?: string };
    };

export type TerminalControl = { type: 'resize'; cols: number; rows: number };

export const STATUS_ORANGE_TOKEN = 'status-needs-you';
