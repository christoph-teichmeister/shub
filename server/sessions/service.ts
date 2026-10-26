// Session records in sqlite plus their tmux sessions. One tmux session `shub-<id>` per shub session.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { extname, join } from 'node:path';
import type {
  ClientKind,
  ContextFill,
  HandedCommand,
  OldSession,
  PermissionMode,
  Session,
  SessionLink,
  SessionStatus,
  StartSessionRequest,
  SubagentRun,
} from '../../shared/api.ts';
import { COMPACT_AT } from '../../shared/api.ts';
import { commandTarget } from '../../shared/commands.ts';
import { HttpError } from '../api/router.ts';
import type { Context } from '../context.ts';
import { hookSettings, userStatusLine } from '../hooks/index.ts';
import type { Services, Sessions } from '../services.ts';
import { defaultMrLookup, findMr, mrName, type MrLookup } from './mr.ts';
import { defaultTitler, type Titler } from './title.ts';
import { defaultWaitChecker, type WaitChecker } from './waitcheck.ts';
import {
  autoName,
  buttonPrompt,
  defaultLauncher,
  permissionModeFor,
  shellRc,
  slugify,
  type Launcher,
} from './launch.ts';
import { claudeDir, encodeCwd, findTranscript, listOldSessions, summarizeTranscript } from './old.ts';
import { Tmux } from './tmux.ts';
import { claimSession, remoteSessions, resumeGuard } from '../group/transcripts.ts';

const MIGRATIONS = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, cwd TEXT NOT NULL,
     status TEXT NOT NULL, claude_session_id TEXT, permission_mode TEXT NOT NULL, started_by TEXT NOT NULL,
     parent_id TEXT, links TEXT NOT NULL, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL,
     pending_permission TEXT, token TEXT)`,
  `ALTER TABLE sessions ADD COLUMN waiting_for TEXT`,
  `ALTER TABLE sessions ADD COLUMN wait_check TEXT`,
  'ALTER TABLE sessions ADD COLUMN position INTEGER',
  `ALTER TABLE sessions ADD COLUMN pending_commands TEXT`,
  'ALTER TABLE sessions ADD COLUMN shells INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE sessions ADD COLUMN background_until INTEGER',
  'ALTER TABLE sessions ADD COLUMN tab_position INTEGER',
  'ALTER TABLE sessions ADD COLUMN agents TEXT',
  'ALTER TABLE sessions ADD COLUMN context TEXT',
  'ALTER TABLE sessions ADD COLUMN status_since TEXT',
  'UPDATE sessions SET status_since = last_activity_at',
];
const WAIT_EVERY_MIN = 5;
const COMPACT_PAUSE_CAP_MS = 5 * 60_000;
/** Failed checks in a row before the user hears the check does not work. */
const WAIT_FAILS_NOTIFY = 3;

const GLOBAL_ID = 'global';
const LIVE: SessionStatus[] = ['new', 'working', 'needs-you', 'your-turn', 'waiting'];
export const NAMED_KEYS = new Set(['Escape', 'C-c', 'Up', 'Down', 'PageUp', 'PageDown', 'Tab', 'Enter']);
const LITERAL_MAX = 2000;
const TEXT_PASTE_MAX = 1024 * 1024;
export const FILE_PASTE_MAX = 500 * 1024 * 1024;
const PASTE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const RECONCILE_MS = 3000;
/** Gap between sessions a restore brings back: all Claudes at once freeze the machine and the window. */
const RESTORE_GAP_MS = 4000;
/** After SessionStart, until Claude's input box takes keys. */
const STARTED_GAP_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  kind: Session['kind'];
  project_id: string | null;
  name: string;
  cwd: string;
  status: SessionStatus;
  claude_session_id: string | null;
  permission_mode: Session['permissionMode'];
  started_by: string;
  parent_id: string | null;
  links: string;
  created_at: string;
  last_activity_at: string;
  pending_permission: string | null;
  pending_commands: string | null;
  shells: number;
  /** Epoch ms: a turn that ended on background work is handed back then if no hook came first. */
  background_until: number | null;
  token: string | null;
  waiting_for: string | null;
  wait_check: string | null;
  position: number | null;
  tab_position: number | null;
  agents: string | null;
  context: string | null;
  status_since: string;
}

const toSession = (r: Row): Session => ({
  id: r.id,
  kind: r.kind,
  projectId: r.project_id,
  name: r.name,
  cwd: r.cwd,
  status: r.status,
  claudeSessionId: r.claude_session_id,
  permissionMode: r.permission_mode,
  startedBy: r.started_by,
  parentId: r.parent_id,
  links: JSON.parse(r.links),
  createdAt: r.created_at,
  lastActivityAt: r.last_activity_at,
  statusSince: r.status_since,
  pendingPermission: r.pending_permission ? JSON.parse(r.pending_permission) : null,
  waitingFor: r.waiting_for,
  waitCheck: r.wait_check ? JSON.parse(r.wait_check) : null,
  position: r.position,
  tabPosition: r.tab_position,
  // Rows from before targets stored plain strings.
  pendingCommands: r.pending_commands
    ? (JSON.parse(r.pending_commands) as (string | HandedCommand)[]).map((c) =>
        typeof c === 'string' ? { command: c } : c,
      )
    : null,
  shells: r.shells,
  background: r.background_until !== null,
  agents: r.agents ? JSON.parse(r.agents) : [],
  context: r.context ? JSON.parse(r.context) : null,
});

export const tmuxName = (id: string): string => `shub-${id}`;
const BOOT_CAP_MS = 30_000;
const now = (): string => new Date().toISOString();
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export interface SessionsOptions {
  launcher?: Launcher;
  titler?: Titler;
  mrLookup?: MrLookup;
  waitChecker?: WaitChecker;
  restoreGapMs?: number;
  startedGapMs?: number;
}

export class SessionsService implements Sessions {
  #ctx: Context;
  #services: Services;
  #launcher: Launcher;
  #titler: Titler;
  #mrLookup: MrLookup;
  /** The last name shub itself gave each session; any other name (button, user, skill) is never overwritten.
   *  ponytail: in memory, so after a shub restart only "Session N" names follow an MR link. */
  #autoNames = new Map<string, string>();
  #waitChecker: WaitChecker;
  /** Sessions whose background check is running right now. */
  #checking = new Set<string>();
  #tmux!: Tmux;
  #binDir: string;
  #shellRc: string;
  #restorable = new Set<string>();
  /** Resumed Claudes whose SessionStart hook has not fired yet. */
  #booting = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #restoreGapMs: number;
  #startedGapMs: number;
  /** Commands to type once their resumed session's Claude is up (SessionStart). */
  #afterStart = new Map<string, () => void>();
  /** Sessions being compacted before they park -> whether they pause once the fill drops. */
  #compacting = new Map<string, boolean>();

  constructor(ctx: Context, services: Services, options: SessionsOptions = {}) {
    this.#ctx = ctx;
    this.#services = services;
    this.#launcher = options.launcher ?? defaultLauncher;
    this.#titler = options.titler ?? defaultTitler;
    this.#mrLookup = options.mrLookup ?? defaultMrLookup;
    this.#waitChecker = options.waitChecker ?? defaultWaitChecker;
    this.#restoreGapMs = options.restoreGapMs ?? RESTORE_GAP_MS;
    this.#startedGapMs = options.startedGapMs ?? STARTED_GAP_MS;
    this.#binDir = join(ctx.paths.stateDir, 'bin');
    this.#shellRc = join(ctx.paths.stateDir, 'shell.bashrc');
  }

  get tmux(): Tmux {
    return this.#tmux;
  }

  init(): void {
    this.#services.state.migrate('sessions', MIGRATIONS);
    mkdirSync(this.#binDir, { recursive: true, mode: 0o700 });
    const wrapper = join(this.#binDir, 'shub');
    const cli = join(this.#ctx.paths.appDir, 'cli', 'shub.ts');
    writeFileSync(wrapper, `#!/bin/sh\nexec node ${shellQuote(cli)} "$@"\n`, { mode: 0o755 });
    chmodSync(wrapper, 0o755);
    writeFileSync(this.#shellRc, shellRc(shellQuote(wrapper)));
    this.#tmux = new Tmux(this.#ctx.tmuxSocket, join(this.#ctx.paths.stateDir, 'tmux.conf'));
  }

  get #db() {
    return this.#services.state.db;
  }

  #row(id: string): Row | undefined {
    return this.#db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
  }

  #rows(): Row[] {
    return this.#db
      .prepare(`SELECT * FROM sessions WHERE status != 'exited' ORDER BY created_at`)
      .all() as unknown as Row[];
  }

  #emitUpdated(id: string): Session {
    const session = this.get(id)!;
    this.#ctx.bus.emit({ type: 'session.updated', session });
    return session;
  }

  list(): Session[] {
    return this.#rows().map((r) => ({ ...toSession(r), booting: this.#booting.has(r.id) }));
  }

  /** Claude conversations of closed sessions: killed with the session, so their last write is no sign of work. */
  closedClaudeIds(): Set<string> {
    const rows = this.#db
      .prepare(`SELECT claude_session_id AS id FROM sessions WHERE status = 'exited' AND claude_session_id IS NOT NULL`)
      .all() as { id: string }[];
    return new Set(rows.map((r) => r.id));
  }

  get(id: string): Session | undefined {
    const row = this.#row(id);
    return row && { ...toSession(row), booting: this.#booting.has(id) };
  }

  /** Must exist and not be exited. */
  require(id: string): Session {
    const session = this.get(id);
    if (!session || session.status === 'exited') throw new HttpError(404, 'no such session');
    return session;
  }

  #requireRunning(id: string): Session {
    const session = this.require(id);
    if (!this.#tmux.has(tmuxName(id))) throw new HttpError(409, 'session is not running');
    return session;
  }

  #nextNumber(prefix: string): number {
    const ids = this.#db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    const pattern = new RegExp(`^${prefix.replace(/[^a-z0-9]/g, '\\$&')}(\\d+)$`);
    return 1 + Math.max(0, ...ids.map((r) => Number(pattern.exec(r.id)?.[1] ?? 0)));
  }

  async start(request: StartSessionRequest, startedBy: string, byUser = false): Promise<Session> {
    if (request.kind === 'global') {
      const existing = this.get(GLOBAL_ID);
      if (existing && existing.status !== 'exited') {
        // The global Claude runs all the time, so a prompt (already approved by the caller) is typed into it.
        // ponytail: a paused global Claude keeps the prompt out; resume first if plugins need that.
        if (request.prompt && existing.status !== 'paused') {
          this.#tmux.paste(tmuxName(GLOBAL_ID), request.prompt);
          this.#tmux.sendKey(tmuxName(GLOBAL_ID), 'Enter');
        }
        return existing;
      }
      this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(GLOBAL_ID);
    }
    const parent = request.kind !== 'global' && request.parentId ? this.require(request.parentId) : undefined;
    const projectId = request.kind === 'global' ? null : (parent?.projectId ?? request.projectId);
    const project = projectId ? this.#services.config.project(projectId) : undefined;
    if (request.kind === 'claude' && !project) throw new HttpError(404, 'no such project');
    const button = request.buttonId ? project?.buttons.find((b) => b.id === request.buttonId) : undefined;
    if (request.buttonId && !button) throw new HttpError(404, 'no such button');

    const cwd = request.cwd ?? parent?.cwd ?? project?.path ?? homedir();
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new HttpError(400, `no such folder: ${cwd}`);
    const resumeId = request.kind === 'claude' ? request.resumeClaudeSessionId : undefined;
    const resumed = resumeId ? this.#resumable(cwd, resumeId) : undefined;
    // What another host owns is resumed in place only when its owner is done with it and our copy is whole, or the
    // user takes it over; a fork always works and leaves the original alone.
    const remote = !!resumeId && remoteSessions(this.#services.group).some((r) => r.claudeSessionId === resumeId);
    if (resumeId && remote && !request.fork) {
      const file = join(claudeDir(), 'projects', encodeCwd(cwd), `${resumeId}.jsonl`);
      const refused = resumeGuard(
        this.#services.group,
        resumeId,
        statSync(file, { throwIfNoEntry: false })?.size ?? 0,
        request.takeOver,
      );
      if (refused) throw new HttpError(409, refused);
    }
    const fork = !!request.fork;
    const slug = project ? slugify(project.id) : GLOBAL_ID;
    const prefix = request.kind === 'shell' ? `${slug}-sh` : `${slug}-`;
    const n = request.kind === 'global' ? 1 : this.#nextNumber(prefix);
    const id = request.kind === 'global' ? GLOBAL_ID : `${prefix}${n}`;
    const prompt = button ? buttonPrompt(button, request.input) : request.prompt?.trim() || undefined;
    const namePrompt =
      request.name?.trim() || request.kind !== 'claude' || button ? undefined : (prompt ?? resumed?.firstPrompt);
    const name =
      request.name?.trim() ||
      (request.kind === 'global'
        ? 'Global Claude'
        : request.kind === 'shell'
          ? `Terminal ${n}`
          : autoName({ button, input: request.input, prompt: namePrompt, n }));

    const at = now();
    this.#db
      .prepare(
        `INSERT INTO sessions (id, kind, project_id, name, cwd, status, claude_session_id, permission_mode, started_by,
         parent_id, links, created_at, last_activity_at, status_since, pending_permission, token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        request.kind,
        projectId ?? null,
        name.slice(0, 200),
        cwd,
        prompt ? 'working' : request.kind === 'shell' || resumed ? 'your-turn' : 'new',
        request.kind === 'shell' ? null : (resumeId ?? randomUUID()),
        request.kind === 'shell'
          ? 'default'
          : permissionModeFor(
              button,
              this.#services.config.get().defaultPermissionMode,
              byUser || request.kind === 'global',
            ),
        startedBy,
        parent?.id ?? null,
        '[]',
        at,
        at,
        at,
        null,
        null,
      );
    try {
      this.#launch(this.#row(id)!, { prompt, resume: !!resumeId, fork: fork });
    } catch (err) {
      const token = this.#row(id)?.token;
      if (token) this.#services.auth.revokeClientToken(token);
      this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      throw err;
    }
    if (resumeId && remote && !fork) claimSession(this.#services.group, resumeId, hostname());
    const session = this.get(id)!;
    this.#ctx.bus.emit({ type: 'session.started', session, from: request.from });
    this.#services.permissions.log({ actor: startedBy, action: 'session.start', detail: `${id}: ${session.name}` });
    if (namePrompt) this.#retitle(id, namePrompt, session.name);
    return session;
  }

  nameFromPrompt(id: string, prompt: string): void {
    const quick = autoName({ prompt, n: 0 });
    this.rename(id, quick, 'shub');
    this.#retitle(id, prompt, quick);
  }

  /** The quick name stays until the model's title arrives, and stays for good if the user renamed meanwhile. */
  #retitle(id: string, prompt: string, quick: string): void {
    this.#autoNames.set(id, quick);
    void this.#titler(prompt).then((title) => {
      if (title && this.#autoNamed(id) && this.get(id)?.name === quick) this.#autoRename(id, title);
    });
  }

  nameFromMr(id: string, prompt: string): void {
    const ref = findMr(prompt);
    const session = this.get(id);
    if (!ref || !session || session.links.some((l) => l.url === ref.url)) return;
    this.addLink(id, { source: 'shub', url: ref.url, label: ref.label });
    if (!this.#autoNamed(id)) return;
    void this.#mrLookup(ref).then((mr) => {
      if (mr && this.#autoNamed(id)) this.#autoRename(id, mrName(ref, mr));
    });
  }

  #autoNamed(id: string): boolean {
    const name = this.get(id)?.name;
    return !!name && (/^Session \d+$/.test(name) || this.#autoNames.get(id) === name);
  }

  #autoRename(id: string, name: string): void {
    this.rename(id, name, 'shub');
    this.#autoNames.set(id, this.get(id)!.name);
  }

  /** An old conversation of this folder that no live shub session holds. */
  #resumable(cwd: string, claudeSessionId: string): { firstPrompt: string } {
    if (!UUID.test(claudeSessionId)) throw new HttpError(400, 'resumeClaudeSessionId must be a UUID');
    if (this.list().some((s) => s.claudeSessionId === claudeSessionId)) {
      throw new HttpError(409, 'that conversation is already open in a session');
    }
    const file = join(claudeDir(), 'projects', encodeCwd(cwd), `${claudeSessionId}.jsonl`);
    let jsonl: string;
    try {
      jsonl = readFileSync(file, 'utf8');
    } catch {
      throw new HttpError(404, 'no such conversation in this project');
    }
    return summarizeTranscript(jsonl);
  }

  #clientKind(row: Row): ClientKind {
    if (row.id === GLOBAL_ID) return 'global-claude';
    return row.started_by.startsWith('session:') ? 'spawned-session' : 'session';
  }

  #launch(row: Row, opts: { prompt?: string; resume: boolean; fork?: boolean }): void {
    const env: Record<string, string> = {
      SHUB_URL: `http://127.0.0.1:${this.#ctx.port}`,
      // Shells get it too (no token: the CLI there signs in as you), so `shub claude` knows its terminal.
      SHUB_SESSION_ID: row.id,
      PATH: `${this.#binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    };
    const settingsFile = join(this.#ctx.paths.stateDir, 'sessions', row.id, 'settings.json');
    if (row.kind !== 'shell') {
      mkdirSync(join(settingsFile, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(
        settingsFile,
        JSON.stringify(
          hookSettings(this.#ctx.paths.appDir, this.#ctx.paths.stateDir, userStatusLine(row.cwd)),
          null,
          2,
        ),
      );
      // Stored in clear (stateDir is 0700) so it can be revoked after a restart; auth only keeps its hash.
      let token = row.token;
      if (!token) {
        token = this.#services.auth.issueClientToken({
          kind: this.#clientKind(row),
          id: `session:${row.id}`,
          rights: [],
        });
        this.#db.prepare('UPDATE sessions SET token = ? WHERE id = ?').run(token, row.id);
      }
      env.SHUB_TOKEN = token;
    }
    const argv = this.#launcher({
      kind: row.kind,
      claudeSessionId: row.claude_session_id,
      settingsFile,
      shellRc: this.#shellRc,
      permissionMode: row.permission_mode,
      prompt: opts.prompt,
      resume: opts.resume,
      fork: opts.fork,
    });
    this.#tmux.newSession(tmuxName(row.id), row.cwd, env, argv);
  }

  /** Kill tmux, revoke the token, mark exited, close child shells. */
  #end(row: Row): void {
    for (const child of this.#rows().filter((r) => r.parent_id === row.id)) this.#end(child);
    this.#tmux.kill(tmuxName(row.id));
    if (row.token) this.#services.auth.revokeClientToken(row.token);
    this.#db
      .prepare(
        `UPDATE sessions SET status = 'exited', token = NULL, pending_permission = NULL, pending_commands = NULL WHERE id = ?`,
      )
      .run(row.id);
    this.#restorable.delete(row.id);
    this.#booting.delete(row.id);
    this.#ctx.bus.emit({ type: 'session.closed', sessionId: row.id });
  }

  close(id: string, actor: string): void {
    const session = this.require(id);
    this.#end(this.#row(id)!);
    this.#services.permissions.log({ actor, action: 'session.close', detail: `${id}: ${session.name}` });
  }

  rename(id: string, name: string, actor: string): Session {
    const before = this.require(id);
    const clean = name.trim().slice(0, 200);
    if (!clean) throw new HttpError(400, 'name must not be empty');
    this.#db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(clean, id);
    this.#services.permissions.log({ actor, action: 'session.rename', detail: `${id}: ${before.name} -> ${clean}` });
    return this.#emitUpdated(id);
  }

  /** Parks the session until `reason` happens, or (null) ends the wait: back to "your-turn".
   *  With `check`, a small model looks every `everyMinutes` and ends the wait once it happened: it then types
   *  `onDone` into the session, or (none) notifies the user. */
  wait(
    id: string,
    reason: string | null,
    actor: string,
    check?: { prompt: string; everyMinutes?: number; onDone?: string | null },
  ): Session {
    const session = this.require(id);
    if (session.kind === 'shell') throw new HttpError(400, 'shells cannot wait');
    const clean = reason?.trim().slice(0, 200) || null;
    if (reason !== null && !clean) throw new HttpError(400, 'waitingFor must not be empty');
    const prompt = clean && check?.prompt.trim().slice(0, 2000);
    const waitCheck = prompt
      ? {
          prompt,
          everyMinutes: Math.max(WAIT_EVERY_MIN, Math.round(check?.everyMinutes ?? 30)),
          // Runs at once, so the user sees right away whether the check makes sense.
          checkedAt: null,
          last: null,
          onDone: check?.onDone?.trim().slice(0, 2000) || null,
          failures: 0,
        }
      : null;
    this.#db
      .prepare('UPDATE sessions SET waiting_for = ?, wait_check = ? WHERE id = ?')
      .run(clean, waitCheck && JSON.stringify(waitCheck), id);
    // Mid-turn (working, or a permission question open) the status follows on the turn's Stop hook.
    // "needs-you" without a question is Claude's idle reminder after the turn: no Stop follows, park now.
    const idle =
      ['your-turn', 'new'].includes(session.status) || (session.status === 'needs-you' && !session.pendingPermission);
    if (clean && idle) this.setStatus(id, 'waiting');
    if (clean && idle && session.kind === 'claude') this.#compactParking(id, false);
    if (!clean && session.status === 'waiting') this.setStatus(id, 'your-turn');
    this.#services.permissions.log({
      actor,
      action: clean ? 'session.wait' : 'session.ready',
      detail: `${id}: ${clean ?? session.waitingFor ?? ''}`,
    });
    return this.#emitUpdated(id);
  }

  /** Pins sessions to a place in their project's sidebar list, or with `tabs` sets their tab order (drag and drop);
   *  null hands one back to the default order. */
  reorder(positions: Record<string, number | null>, tabs = false): Session[] {
    const column = tabs ? 'tab_position' : 'position';
    for (const [id, position] of Object.entries(positions)) {
      this.require(id);
      this.#db.prepare(`UPDATE sessions SET ${column} = ? WHERE id = ?`).run(position, id);
    }
    return Object.keys(positions).map((id) => this.#emitUpdated(id));
  }

  setStatus(
    id: string,
    status: SessionStatus,
    pendingPermission?: Session['pendingPermission'],
    pendingCommands?: Session['pendingCommands'],
    background = 0,
    shells = 0,
  ): void {
    const session = this.get(id);
    if (!session || session.status === 'exited') return;
    const keep = status === 'needs-you';
    const pending = pendingPermission !== undefined ? pendingPermission : keep ? session.pendingPermission : null;
    const commands = pendingCommands !== undefined ? pendingCommands : keep ? session.pendingCommands : null;
    const at = now();
    const since = status === session.status ? session.statusSince : at;
    this.#db
      .prepare(
        'UPDATE sessions SET status = ?, status_since = ?, pending_permission = ?, pending_commands = ?, shells = ?, background_until = ?, last_activity_at = ? WHERE id = ?',
      )
      .run(
        status,
        since,
        pending ? JSON.stringify(pending) : null,
        commands?.length ? JSON.stringify(commands) : null,
        shells,
        background ? Date.now() + background : null,
        at,
        id,
      );
    this.#ctx.bus.emit({ type: 'session.status', sessionId: id, status, statusSince: since });
    this.#emitUpdated(id);
    // The compact turn ended after the fill had already dropped: the pending pause follows now.
    if (
      this.#compacting.get(id) &&
      ['waiting', 'your-turn'].includes(status) &&
      (session.context?.tokens ?? 0) < COMPACT_AT
    ) {
      this.#compacting.delete(id);
      this.pause(id, 'shub:auto-compact');
    }
  }

  keepBackground(id: string, ms: number): void {
    this.#db
      .prepare('UPDATE sessions SET background_until = ? WHERE id = ? AND background_until IS NOT NULL')
      .run(Date.now() + ms, id);
  }

  setAgents(id: string, agents: SubagentRun[]): void {
    const session = this.get(id);
    if (!session || session.status === 'exited') return;
    this.#db
      .prepare('UPDATE sessions SET agents = ? WHERE id = ?')
      .run(agents.length ? JSON.stringify(agents) : null, id);
    this.#emitUpdated(id);
  }

  setContext(id: string, context: ContextFill | null): void {
    const session = this.get(id);
    if (!session || session.status === 'exited') return;
    if (JSON.stringify(session.context ?? null) === JSON.stringify(context)) return;
    this.#db.prepare('UPDATE sessions SET context = ? WHERE id = ?').run(context && JSON.stringify(context), id);
    this.#emitUpdated(id);
    const wasPaused = this.#compacting.get(id);
    // Status still "working": the compact turn has not reported its Stop yet; setStatus pauses then.
    if (
      wasPaused !== undefined &&
      (context?.tokens ?? 0) < COMPACT_AT &&
      !(wasPaused && session.status === 'working')
    ) {
      this.#compacting.delete(id);
      // The user may have taken the session over meanwhile.
      if (wasPaused && ['waiting', 'your-turn'].includes(session.status)) this.pause(id, 'shub:auto-compact');
    }
    // A wait set mid-turn parks on the Stop hook; its fill arrives here a moment later.
    else if (session.status === 'waiting' && session.kind === 'claude') this.#compactParking(id, false);
  }

  /** An idle, full session is compacted as it parks (pause, wait); `thenPause` pauses once the fill dropped. */
  #compactParking(id: string, thenPause: boolean): boolean {
    const session = this.get(id);
    const idle = session && ['your-turn', 'waiting'].includes(session.status);
    if (!idle || !this.#tmux.has(tmuxName(id)) || (session.context?.tokens ?? 0) < COMPACT_AT) return false;
    if (this.#compacting.has(id)) return true;
    this.#compacting.set(id, thenPause);
    this.sendKeys(id, ['/compact', 'Enter']);
    // ponytail: fixed 5 min cap; a /compact that never reports back pauses anyway
    if (thenPause) {
      setTimeout(() => {
        if (this.#compacting.delete(id) && this.get(id)?.status !== 'paused') this.pause(id, 'shub:auto-compact');
      }, COMPACT_PAUSE_CAP_MS).unref();
    }
    return true;
  }

  setClaudeSessionId(id: string, claudeSessionId: string): void {
    const session = this.get(id);
    if (!session || session.status === 'exited' || session.kind === 'shell') return;
    this.#db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(claudeSessionId, id);
    this.#emitUpdated(id);
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    const session = this.get(id);
    if (!session || session.status === 'exited' || session.permissionMode === mode) return;
    this.#db.prepare('UPDATE sessions SET permission_mode = ? WHERE id = ?').run(mode, id);
    this.#emitUpdated(id);
  }

  pause(id: string, actor: string, compact = true): Session {
    const session = this.require(id);
    if (session.kind === 'shell') throw new HttpError(400, 'shells cannot be paused');
    // Full and idle: compact first, so the resume later does not carry 160k+ tokens; the pause follows.
    if (compact && session.kind === 'claude' && this.#compactParking(id, true)) return session;
    this.#compacting.delete(id);
    this.#tmux.kill(tmuxName(id));
    this.#restorable.delete(id);
    this.setStatus(id, 'paused', null);
    this.#services.permissions.log({ actor, action: 'session.pause', detail: `${id}: ${session.name}` });
    return this.get(id)!;
  }

  /** Paused or restorable sessions: Claude resumes its conversation, shells start fresh. */
  resume(id: string, actor: string): Session {
    const session = this.require(id);
    if (this.#tmux.has(tmuxName(id))) throw new HttpError(409, 'session is already running');
    // A conversation without a prompt has no transcript, and `claude --resume` would exit at once: start it fresh.
    const transcript = session.claudeSessionId ? findTranscript(session.claudeSessionId, session.cwd) : null;
    const hasTranscript = !!transcript;
    // It moved into a worktree: resume it there, or Claude starts an empty conversation under the old id.
    if (transcript && transcript.cwd !== session.cwd) {
      this.#db.prepare('UPDATE sessions SET cwd = ? WHERE id = ?').run(transcript.cwd, id);
    }
    this.#launch(this.#row(id)!, { resume: hasTranscript });
    this.#restorable.delete(id);
    if (session.kind !== 'shell') {
      this.#booting.add(id);
      // ponytail: fixed cap so a hook that never arrives cannot leave the overlay up
      setTimeout(() => this.#unboot(id), BOOT_CAP_MS).unref();
    }
    this.setStatus(
      id,
      session.waitingFor ? 'waiting' : hasTranscript || session.kind === 'shell' ? 'your-turn' : 'new',
      null,
    );
    this.#services.permissions.log({ actor, action: 'session.resume', detail: `${id}: ${session.name}` });
    return this.get(id)!;
  }

  restorable(): Session[] {
    return [...this.#restorable].map((id) => this.get(id)!).filter(Boolean);
  }

  /**
   * Resumes the chosen ones one after another (status `starting` until their turn); the rest of the
   * restorable list is given up (marked exited). Returns the queued sessions.
   */
  restore(ids: string[], actor: string): Session[] {
    const chosen = new Set(ids);
    for (const id of [...this.#restorable]) {
      if (!chosen.has(id)) this.#end(this.#row(id)!);
    }
    // Parents before their shells, so a shell's parent is running when it comes back.
    const queue = [...this.#restorable].sort(
      (a, b) => Number(!!this.get(a)?.parentId) - Number(!!this.get(b)?.parentId),
    );
    for (const id of queue) {
      this.#restorable.delete(id);
      this.setStatus(id, 'starting', null);
    }
    const queued = queue.map((id) => this.get(id)!);
    void this.#resumeQueue(queue, actor);
    return queued;
  }

  async #resumeQueue(queue: string[], actor: string): Promise<void> {
    for (const [i, id] of queue.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.#restoreGapMs));
      // Closed or paused while it waited its turn.
      if (this.get(id)?.status !== 'starting') continue;
      try {
        this.resume(id, actor);
      } catch (err) {
        console.error(`shub: resume ${id}`, err);
        this.#end(this.#row(id)!);
      }
    }
  }

  sendKeys(id: string, keys: string[]): void {
    this.#requireRunning(id);
    for (const key of keys) {
      if (typeof key !== 'string' || key.length === 0 || key.length > LITERAL_MAX) {
        throw new HttpError(400, `keys must be named keys or text up to ${LITERAL_MAX} chars`);
      }
    }
    for (const key of keys) {
      if (NAMED_KEYS.has(key)) this.#tmux.sendKey(tmuxName(id), key);
      else this.#tmux.sendLiteral(tmuxName(id), key);
    }
  }

  /**
   * A command Claude handed over: "run" types `!` (Claude's bash mode), pastes it and presses Enter, in
   * the session it names (resumed first when it is down) or else this one; both actions clear the list and hand
   * the turn back.
   */
  answerCommand(id: string, index: number, action: 'run' | 'dismiss'): void {
    const handed = this.get(id)?.pendingCommands?.[index];
    if (handed === undefined) throw new HttpError(404, 'no such command waiting');
    if (action === 'run') {
      const target = commandTarget(handed, this.list(), id);
      if (target.kind === 'folder' || target.kind === 'unknown') {
        throw new HttpError(409, 'no session to run it in: use Open in terminal');
      }
      const into = target.kind === 'session' ? target.session.id : id;
      this.#typeInto(into, 'shub:command', () => {
        this.sendKeys(into, ['!']);
        this.pasteText(into, handed.command);
        this.sendKeys(into, ['Enter']);
      });
    }
    this.setStatus(id, 'your-turn', null, null);
  }

  /** Types into the session now, or resumes it first and types once Claude is up. */
  #typeInto(id: string, actor: string, type: () => void): void {
    if (this.#tmux.has(tmuxName(id))) type();
    else if (this.get(id)?.status === 'starting') throw new HttpError(409, 'that session is still starting');
    else {
      this.resume(id, actor);
      this.#afterStart.set(id, type);
    }
  }

  #unboot(id: string): void {
    if (this.#booting.delete(id)) this.#emitUpdated(id);
  }

  /** Claude's SessionStart hook: it is up, so a command waiting for this session goes in now. */
  started(id: string): void {
    this.#unboot(id);
    const type = this.#afterStart.get(id);
    if (!type) return;
    this.#afterStart.delete(id);
    // ponytail: fixed pause for the input box after SessionStart; wait for the prompt if keys get lost
    setTimeout(() => {
      try {
        type();
      } catch (err) {
        console.error(`shub: command for ${id}`, err);
      }
    }, this.#startedGapMs).unref();
  }

  /** Where a running session's shell is now; for "Start Claude here" in a terminal. */
  currentPath(id: string): string {
    this.#requireRunning(id);
    return this.#tmux.currentPath(tmuxName(id));
  }

  pasteText(id: string, text: string): void {
    this.#requireRunning(id);
    if (!text || text.length > TEXT_PASTE_MAX) throw new HttpError(400, 'text must be 1 byte to 1 MB');
    this.#tmux.paste(tmuxName(id), text);
  }

  /** Saves any file under <stateDir>/pastes and pastes its absolute path (Claude picks up image paths). */
  pasteFile(id: string, contentType: string, body: Buffer, name = ''): string {
    this.#requireRunning(id);
    const nameExt = extname(name).slice(1).toLowerCase();
    const ext =
      PASTE_TYPES[contentType.split(';')[0].trim().toLowerCase()] ??
      (/^[a-z0-9]{1,10}$/.test(nameExt) ? nameExt : 'bin');
    if (body.length === 0 || body.length > FILE_PASTE_MAX) throw new HttpError(413, 'file must be 1 byte to 500 MB');
    const dir = join(this.#ctx.paths.stateDir, 'pastes');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${randomUUID()}.${ext}`);
    writeFileSync(file, body, { mode: 0o600 });
    this.#tmux.paste(tmuxName(id), file);
    return file;
  }

  addLink(id: string, link: SessionLink): Session {
    const session = this.require(id);
    const links = [...session.links.filter((l) => l.url !== link.url), link];
    this.#db.prepare('UPDATE sessions SET links = ? WHERE id = ?').run(JSON.stringify(links), id);
    return this.#emitUpdated(id);
  }

  oldSessions(projectId: string): OldSession[] {
    const project = this.#services.config.project(projectId);
    if (!project) return [];
    const live = new Set(this.list().flatMap((s) => (s.claudeSessionId ? [s.claudeSessionId] : [])));
    const old = listOldSessions(projectId, project.path, live);
    // The sessions other hosts ran: marked with their host; one whose transcript has not arrived (or whose folder
    // is missing here) shows dimmed.
    const remote = remoteSessions(this.#services.group).filter(
      (r) => r.projectId === projectId && !live.has(r.claudeSessionId),
    );
    const usable = !!statSync(project.path, { throwIfNoEntry: false })?.isDirectory();
    const copied = new Set(old.map((o) => o.claudeSessionId));
    for (const o of old) {
      const r = remote.find((x) => x.claudeSessionId === o.claudeSessionId);
      if (r) Object.assign(o, { host: r.host, running: r.running, resumable: usable });
    }
    for (const r of remote)
      if (!copied.has(r.claudeSessionId))
        old.push({
          claudeSessionId: r.claudeSessionId,
          projectId,
          firstPrompt: r.name,
          turns: 0,
          lastAt: r.lastAt,
          host: r.host,
          running: r.running,
          resumable: false,
        });
    return old.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  /** At startup: sessions whose tmux died with the machine become restorable; the global Claude comes back on its own. */
  startup(): void {
    const running = this.#tmux.sessions();
    for (const row of this.#rows()) {
      // `starting`: shub stopped before its restore queue reached it.
      const live = LIVE.includes(row.status) || row.status === 'starting';
      if (live && !running.has(tmuxName(row.id))) this.#restorable.add(row.id);
    }
    const global = this.get(GLOBAL_ID);
    if (global && this.#restorable.has(GLOBAL_ID)) this.resume(GLOBAL_ID, 'shub');
    else if (!global || global.status === 'exited') {
      this.start({ kind: 'global', projectId: null }, 'shub').catch((err) => console.error('shub: global Claude', err));
    }
    this.#timer = setInterval(() => this.reconcile(), RECONCILE_MS);
    this.#timer.unref();
  }

  /** Claude or the shell exited on its own: the tmux session is gone. Also starts due wait checks and hands
   *  back sessions whose background work has run past its fallback (kept in the db, so it survives a restart). */
  reconcile(at = Date.now()): void {
    for (const { id } of this.#rows().filter(
      (r) => r.background_until !== null && r.background_until <= at && !this.#restorable.has(r.id),
    )) {
      const waiting = !!this.get(id)?.waitingFor;
      this.setStatus(id, waiting ? 'waiting' : 'your-turn', null);
      const session = this.get(id);
      if (session && !waiting) this.#services.notify.yourTurn(session);
    }
    const running = this.#tmux.sessions();
    for (const row of this.#rows()) {
      if (LIVE.includes(row.status) && !this.#restorable.has(row.id) && !running.has(tmuxName(row.id))) {
        this.#end(row);
      } else if (row.status === 'waiting' && row.wait_check) void this.checkWait(row.id);
    }
  }

  /** Runs the session's background check when it is due (or `force`); ends the wait once it happened. */
  async checkWait(id: string, force = false): Promise<void> {
    const before = this.get(id);
    const check = before?.status === 'waiting' ? before.waitCheck : null;
    if (!check || this.#checking.has(id)) return;
    const due = !check.checkedAt || Date.now() - Date.parse(check.checkedAt) >= check.everyMinutes * 60_000;
    if (!due && !force) return;
    this.#checking.add(id);
    try {
      const result = await this.#waitChecker(check.prompt, before!.cwd).catch(() => null);
      const current = this.get(id);
      // The wait changed or ended meanwhile: this answer belongs to an old check.
      if (current?.waitCheck?.prompt !== check.prompt || current.waitingFor !== before!.waitingFor) return;
      const last = result ? `${result.done ? 'DONE' : 'NOT YET'}: ${result.summary}` : 'Check failed';
      const failures = result ? 0 : (check.failures ?? 0) + 1;
      const updated = { ...check, checkedAt: now(), last, failures };
      this.#db.prepare('UPDATE sessions SET wait_check = ? WHERE id = ?').run(JSON.stringify(updated), id);
      if (result?.done && current.status === 'waiting') {
        const session = this.wait(id, null, 'shub:wait-check');
        if (check.onDone) this.#resumeAfterWait(session, check.onDone.replaceAll('{summary}', result.summary));
        else this.#services.notify.needsYou(session, result.summary);
      } else {
        const session = this.#emitUpdated(id);
        if (failures === WAIT_FAILS_NOTIFY) {
          this.#services.notify.needsYou(session, `Wait check failed ${failures} times in a row: ${check.prompt}`);
        }
      }
    } finally {
      this.#checking.delete(id);
    }
  }

  /** The wait is over: Claude goes on with `text`; when that cannot be typed, the user hears of it instead. */
  #resumeAfterWait(session: Session, text: string): void {
    try {
      this.#typeInto(session.id, 'shub:wait-check', () => {
        this.pasteText(session.id, text);
        this.sendKeys(session.id, ['Enter']);
      });
    } catch (err) {
      console.error(`shub: wait follow-up for ${session.id}`, err);
      this.#services.notify.needsYou(session, `Done waiting, but shub could not send: ${text}`);
    }
  }

  stop(): void {
    clearInterval(this.#timer);
  }
}
