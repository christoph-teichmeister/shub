// The one contract between the shub server, the web app, the `shub` CLI and plugins.
// Server modules implement it, everyone else only talks to it over HTTP/WebSocket.
// Bump API_VERSION on any breaking change and note it in docs/API.md.

export const API_VERSION = 1;
/** From this many context tokens on, a session is offered /compact; idle ones (waiting, paused) get it automatically. */
export const COMPACT_AT = 160_000;

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
    /** Git URL it was installed from; a machine without the plugin clones it from here on start. */
    source?: string;
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
  /** What this host syncs with the device group; local.json. A missing category is on, except pluginEnv. */
  sync?: SyncSettings;
  /** Never stored: why config.json or local.json could not be read. shub then runs on the last good config and
   *  refuses changes until the file is fixed (it reloads on save). */
  problem?: string;
}

/** What can sync between the hosts of a device group; the devices themselves always sync. */
export const SYNC_CATEGORIES = [
  'projects',
  'themes',
  'terminal',
  'notifications',
  'permissionMode',
  'plugins',
  'pluginEnv',
  'sessions',
  'transcripts',
] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];
export type SyncSettings = Partial<Record<SyncCategory, boolean>>;

/** Another host of the device group, as Settings > Sync shows it. */
export interface HostPeer {
  id: string;
  name: string;
  /** Its tailnet address; absent while it has none (no public URL set there), so it cannot be dialed. */
  url?: string;
  state: 'in-sync' | 'catching-up' | 'offline' | 'conflict';
  /** When it first failed to answer, while state is offline. */
  since?: string;
}

/** What one host tells another to join its group: id, name, tailnet URL and public key (the host key never leaves). */
export interface HostInfo {
  id: string;
  name: string;
  url?: string;
  publicKey: { kty: string; crv: string; x: string; y: string };
}

/** One side of an open sync conflict: the version this host holds, or the one another host sent. */
export interface ConflictSide {
  /** Names of the hosts that made changes the other side lacks. */
  hosts: string[];
  body: unknown;
  /** The side removes the item. */
  deleted: boolean;
}
/** An item changed on two hosts while apart; the item stays as `ours` until the user picks. */
export interface GroupConflict {
  key: string;
  ours: ConflictSide;
  theirs: ConflictSide;
}

/** One transcript a host offers: the file `<id>.jsonl` in the folder Claude keeps for a synced project. */
export interface TranscriptEntry {
  project: string;
  id: string;
  size: number;
}

/** Settings > Sync: the background copy of the other hosts' transcripts. */
export interface TranscriptProgress {
  running: boolean;
  /** Bytes copied and still to copy in this run. */
  done: number;
  total: number;
  /** What the synced projects' transcripts take on this host. */
  size: number;
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
  /** The session this one is a pane of in the control center (a second Claude or a terminal). */
  parentId: string | null;
  links: SessionLink[];
  createdAt: string;
  lastActivityAt: string;
  /** When the session entered its current status; repeated writes of the same status keep it. */
  statusSince: string;
  /** Permission question waiting on the phone, if any. */
  pendingPermission?: { tool: string; summary: string } | null;
  /** What the session waits for, e.g. "Kai's answer on the MR". While set, a finished turn lands on "waiting"
   *  instead of "your-turn"; cleared by the user or by the session (`shub session ready`). */
  waitingFor?: string | null;
  /** Background check while waiting: a small model reads (never writes) whether it happened, every few minutes. */
  waitCheck?: WaitCheck | null;
  /** Pinned: place among the pinned sessions on top of its project's sidebar list; null sorts by status. */
  position?: number | null;
  /** Place in its project's tab bar the user dragged it to; null follows after, oldest first. */
  tabPosition?: number | null;
  /** Shell commands Claude asked you to run at the end of its turn (status needs-you until run or dismissed). */
  pendingCommands?: HandedCommand[] | null;
  /** Background shells (servers, tests) still running after Claude's turn ended. */
  shells?: number;
  /** Claude's turn ended but background work (agents, shells) still runs: status stays working until it reports back. */
  background?: boolean;
  /** Subagents running inside the session (no pane of their own), from the SubagentStart/Stop hooks. */
  agents?: SubagentRun[];
  /** How full Claude's context is, from the transcript after each turn and tool call; null before the first reply. */
  context?: ContextFill | null;
  /** Resumed and Claude has not reported SessionStart yet: the terminal shows a boot-up animation. */
  booting?: boolean;
}

/** Claude subscription limits from Claude Code's status line: percent used and when the window resets (epoch seconds). */
export interface UsageLimit {
  used: number;
  resetsAt?: number;
}
export interface Usage {
  fiveHour?: UsageLimit;
  sevenDay?: UsageLimit;
}

export interface ContextFill {
  /** Tokens the model saw on its last call. */
  tokens: number;
  /** The model's context window as Claude Code reports it to the status line, else guessed from the transcript. */
  window: number;
}

export interface SubagentRun {
  /** Claude's agent_id. */
  id: string;
  /** agent_type, e.g. "Explore" or a forked skill's name. */
  type: string;
  /** Its last tool call, e.g. "Bash: npm test". */
  activity?: string;
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
  /** What shub types into the session once it happened (`{summary}` = the check's answer); null = only notify. */
  onDone?: string | null;
  /** Checks in a row that gave no answer; the user hears of it at the third. */
  failures?: number;
}

/** POST /api/projects. */
export type CreateProjectRequest = Partial<Omit<Project, 'id' | 'order'>> & {
  name: string;
  path: string;
  /** A missing `path` is created (mkdir -p) and gets `git init`, once the change is allowed. */
  create?: boolean;
};

export interface StartSessionRequest {
  projectId: string | null;
  kind: SessionKind;
  name?: string;
  /** Exactly one of buttonId (+ input) or prompt, or neither for an empty session. */
  buttonId?: string;
  input?: string;
  prompt?: string;
  parentId?: string; // a pane of that session (Claude or shell, cwd defaults to its folder); a shell without one is a session of its own (cwd defaults to the project folder)
  /** Defaults to the parent's cwd, else the project folder. Without a parent it must be one of the project's worktrees. */
  cwd?: string;
  /** kind "claude" only: reopen this old Claude conversation (from oldSessions) with `--resume`. */
  resumeClaudeSessionId?: string;
  /** With resumeClaudeSessionId: continue in a new conversation (`--fork-session`); the original stays untouched. */
  fork?: boolean;
  /**
   * With resumeClaudeSessionId of another host's conversation, no fork: continue it here and become its owner. Without
   * it such a resume is refused with 409 while the owner runs it or this host's transcript is behind the owner's.
   */
  takeOver?: boolean;
  /** The terminal it was started from ("Start Claude here", `shub claude`): a tab showing it jumps to the new one. */
  from?: string;
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

/** GET /api/worktrees/children: a worktree a Claude session created, shown under that session. */
export interface ChildWorktree extends WorktreeInfo {
  /** The shub session that created it; it may have closed since. */
  originSessionId: string;
  /** Newest Claude conversation kept for the folder that no live session holds: a click resumes it. */
  conversation: string | null;
  /** A Claude still writes there (a headless run): no resume until it is idle. */
  busy: boolean;
}

export interface OldSession {
  claudeSessionId: string;
  projectId: string;
  firstPrompt: string;
  turns: number;
  lastAt: string;
  /** Ran on this other host; resuming it forks. */
  host?: string;
  /** Its owner runs it right now: resuming here is refused unless taken over. */
  running?: boolean;
  /** False while the transcript or the project folder is missing on this host: shown dimmed. */
  resumable?: boolean;
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
 * permission questions and Run chips, control = everything. Browsers are control.
 */
export type DeviceLevel = 'view' | 'prompts' | 'control';
export const DEVICE_LEVELS: DeviceLevel[] = ['view', 'prompts', 'control'];

export interface Device {
  id: string;
  name: string;
  /** desktop: the host's own browser (bootstrap); browser: a paired desktop browser; phone. */
  kind: 'desktop' | 'browser' | 'phone';
  pairedAt: string;
  lastSeenAt: string;
  push: boolean;
  level: DeviceLevel;
  /** pending: paired but not yet approved by a trusted host or a Control phone; it cannot sign in. */
  state: 'pending' | 'active';
  /** The host that made the pairing code this device redeemed. */
  host?: string;
}

/**
 * Lowest level a device needs per route. Unlisted routes: GET needs view, everything else control.
 * The server gate (server/auth/levels.ts) enforces it; the web app only uses it to hide what would fail.
 */
export const ROUTE_LEVELS: Partial<Record<keyof typeof ROUTES, DeviceLevel>> = {
  logout: 'view',
  deviceDelete: 'view', // revoke works from any trusted device
  pushSubscribe: 'view',
  pushTest: 'view',
  approvalDecide: 'prompts',
  sessionCommand: 'prompts', // by index only: runs a command Claude handed over, never text from the phone
  sessionKeys: 'prompts', // prompts: named keys and single digits only, see sessions
  // A browser just approved here joins at Prompts; the real gate is the join mark set by that approval (server/group).
  groupJoinOffer: 'prompts',
  groupJoin: 'prompts',
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
  /** The git source has a newer commit than the installed one (checked on start and every 6 h). */
  updateAvailable: boolean;
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
  usage: 'GET /api/usage', // -> Usage | {}: the last 5h/7d limits any session's status line reported
  bundle: 'GET /api/bundle', // { name, manifest, sums?, signature? } for a phone app's loader; 404 in dev builds
  bootstrap: 'POST /api/auth/bootstrap', // { token, deviceName, publicKey } -> { device } (active); loopback only
  logout: 'POST /api/auth/logout',
  me: 'GET /api/auth/me',
  pairingStart: 'POST /api/auth/pairing', // -> { code, url, qrSvg, expiresAt }
  pairingRedeem: 'POST /api/auth/pairing/redeem', // { code, deviceName, publicKey: JWK, kind?: 'browser' } -> { device } (pending)
  authChallenge: 'POST /api/auth/challenge', // { deviceId } -> { nonce }; 409 while the device is pending
  authSession: 'POST /api/auth/session', // { deviceId, nonce, signature } -> { token, expiresAt }
  devices: 'GET /api/devices',
  deviceUpdate: 'PATCH /api/devices/:id', // { name } rename, { level } from a trusted host or a Control phone, never on itself -> Device
  deviceApprove: 'POST /api/devices/:id/approve', // { confirm: true } from a phone; trusted host or Control phone -> Device
  deviceDelete: 'DELETE /api/devices/:id',
  rotateToken: 'POST /api/auth/rotate',

  // Host-to-host sync (server/group/sync.ts): no login, hosts sign a challenge with their key from the group.
  groupChallenge: 'POST /api/group/challenge', // { hostId } -> { nonce }; 403 unless that host is in the group
  groupSession: 'POST /api/group/session', // { hostId, nonce, signature } -> { token }
  groupPull: 'POST /api/group/pull', // Bearer -> { items }
  groupPush: 'POST /api/group/push', // Bearer, { items } -> { changed, conflicts }
  // Join two hosts after a browser paired (see docs/SECURITY.md): the browser carries each host's info to the other.
  groupJoinOffer: 'POST /api/group/join/offer', // -> HostInfo of this host; only a trusted host or a browser just approved here
  groupJoin: 'POST /api/group/join', // { host: HostInfo } -> { ok }; same checks, adds that host to the group and syncs
  groupPeers: 'GET /api/group/peers', // -> HostPeer[], user only
  groupConflicts: 'GET /api/group/conflicts', // -> GroupConflict[]; open ones, any level sees them
  groupResolve: 'POST /api/group/resolve', // { key, pick: 'ours' | 'theirs' } -> 204; control level
  groupManifest: 'POST /api/group/manifest', // Bearer -> { entries: TranscriptEntry[] }; transcripts of the synced projects
  groupChunk: 'POST /api/group/chunk', // Bearer, { project, id, offset } -> { data (zstd, base64), end }
  groupTranscripts: 'GET /api/group/transcripts', // -> TranscriptProgress, user only

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
  worktreeChildren: 'GET /api/worktrees/children', // -> ChildWorktree[] (worktrees sessions created)

  sessions: 'GET /api/sessions',
  sessionStart: 'POST /api/sessions', // StartSessionRequest -> Session | { approval: Approval }
  sessionUpdate: 'PATCH /api/sessions/:id', // { name } rename, { waitingFor: string | null, waitCheck?, waitEveryMinutes?, waitOnDone? } wait / stop
  sessionsReorder: 'POST /api/sessions/reorder', // { positions: { [id]: number | null }, tabs?: true } -> Session[], user only
  sessionClose: 'DELETE /api/sessions/:id',
  sessionClaudeHere: 'POST /api/sessions/:id/claude-here', // shell id, { prompt? } -> Session | { approval }: Claude in the shell's current folder
  sessionPause: 'POST /api/sessions/:id/pause',
  sessionResume: 'POST /api/sessions/:id/resume',
  sessionCommand: 'POST /api/sessions/:id/command', // { index, action: 'run' | 'dismiss' } pendingCommands
  sessionKeys: 'POST /api/sessions/:id/keys', // { keys: "1" | "Escape" | ... } phone quick keys
  sessionPaste: 'POST /api/sessions/:id/paste', // text or multipart image -> path inserted
  sessionMessages: 'GET /api/sessions/:id/messages', // -> ChatMessage[]: the last messages of the Claude transcript (phone chat view); with ?after=<offset> (empty: first call) -> ChatDelta
  sessionLink: 'POST /api/sessions/:id/links', // SessionLink
  notes: 'GET /api/sessions/:id/notes', // -> { path, text, rev }: the session's shared Markdown draft (a pane shares its session's), user only
  notesSave: 'PUT /api/sessions/:id/notes', // { text, rev } -> { rev }; 409 when the file changed since `rev` (Claude edits it too)
  image: 'GET /api/image', // ?path= an image under /tmp/claude-* or the pastes folder -> the file (terminal image viewer)
  markdownLink: 'GET /api/markdown-link', // ?path= a note inside the knowledge base -> { file, url } the real file and the KB app's URL (null without one), 404 if none
  noteFile: 'GET /api/note-file', // ?path= a knowledge base note (markdownLink's file) -> { text, rev }, user only
  noteFileSave: 'PUT /api/note-file', // ?path=, { text, rev } -> { rev }; 409 when the file changed since `rev`
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
  pluginUpgrade: 'POST /api/plugins/:name/upgrade', // user only, pulls the newest commit and restarts it -> PluginInfo

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
  | { type: 'session.started'; session: Session; from?: string }
  | { type: 'session.updated'; session: Session }
  /** statusSince missing from servers before it existed. */
  | { type: 'session.status'; sessionId: string; status: SessionStatus; statusSince?: string }
  | { type: 'session.closed'; sessionId: string }
  /** The transcript has new lines: refetch GET /api/sessions/:id/messages. */
  | { type: 'session.messages'; sessionId: string }
  | { type: 'projects.changed' }
  | { type: 'config.changed' }
  | { type: 'approval.created'; approval: Approval }
  | { type: 'approval.decided'; approval: Approval }
  | { type: 'activity'; entry: ActivityEntry }
  | { type: 'services.changed'; sessionId: string }
  | { type: 'plugins.changed' }
  | { type: 'updates.changed' }
  | { type: 'devices.changed' }
  | { type: 'conflicts.changed' }
  /** A session created a worktree (GET /api/worktrees/children). */
  | { type: 'worktrees.changed' }
  | { type: 'usage.updated'; usage: Usage }
  | {
      type: 'plugin.action';
      plugin: string;
      actionId: string;
      /** entryId: the sidebar section entry whose action was clicked. */
      context: { sessionId?: string; projectId?: string; entryId?: string };
    };

/** One line of the phone chat view. A tool message is updated in place (same id) when its result arrives. */
export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'tool'; name: string; summary: string; status: 'running' | 'ok' | 'error'; result?: string };

/**
 * Answer to `sessionMessages?after=`: the messages since byte `offset` of the transcript, to merge by id (a tool message
 * with an empty name only updates status and result of the call the client has); `reset`: replace the list instead.
 */
export type ChatDelta = { messages: ChatMessage[]; offset: number; reset: boolean };

/** resize: client to server. size: server to a `follow` client (query `follow=1`, `seed=1` replays recent output first). */
export type TerminalControl = { type: 'resize' | 'size'; cols: number; rows: number };

export const STATUS_ORANGE_TOKEN = 'status-needs-you';
