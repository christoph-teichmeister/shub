// Session records in sqlite plus their tmux sessions. One tmux session `shub-<id>` per shub session.
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ClientKind,
  OldSession,
  PermissionMode,
  Session,
  SessionLink,
  SessionStatus,
  StartSessionRequest,
} from '../../shared/api.ts';
import { HttpError } from '../api/router.ts';
import type { Context } from '../context.ts';
import { hookSettings } from '../hooks/index.ts';
import type { Services, Sessions } from '../services.ts';
import { defaultTitler, type Titler } from './title.ts';
import { defaultWaitChecker, type WaitChecker } from './waitcheck.ts';
import { autoName, buttonPrompt, defaultLauncher, permissionModeFor, slugify, type Launcher } from './launch.ts';
import { claudeDir, encodeCwd, listOldSessions, summarizeTranscript } from './old.ts';
import { Tmux } from './tmux.ts';

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
];
const WAIT_EVERY_MIN = 5;

const GLOBAL_ID = 'global';
const LIVE: SessionStatus[] = ['new', 'working', 'needs-you', 'your-turn', 'waiting'];
const NAMED_KEYS = new Set(['Escape', 'C-c', 'Up', 'Down', 'Tab', 'Enter']);
const LITERAL_MAX = 2000;
const TEXT_PASTE_MAX = 1024 * 1024;
const FILE_PASTE_MAX = 20 * 1024 * 1024;
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
/** A background shell may never end (dev server, watcher): after this long without a hook, hand the session back. */
const BACKGROUND_FALLBACK_MS = 10 * 60_000;
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
  token: string | null;
  waiting_for: string | null;
  wait_check: string | null;
  position: number | null;
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
  pendingPermission: r.pending_permission ? JSON.parse(r.pending_permission) : null,
  waitingFor: r.waiting_for,
  waitCheck: r.wait_check ? JSON.parse(r.wait_check) : null,
  position: r.position,
  pendingCommands: r.pending_commands ? JSON.parse(r.pending_commands) : null,
});

export const tmuxName = (id: string): string => `shub-${id}`;
const now = (): string => new Date().toISOString();
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export interface SessionsOptions {
  launcher?: Launcher;
  titler?: Titler;
  waitChecker?: WaitChecker;
  restoreGapMs?: number;
}

export class SessionsService implements Sessions {
  #ctx: Context;
  #services: Services;
  #launcher: Launcher;
  #titler: Titler;
  #waitChecker: WaitChecker;
  /** Sessions whose background check is running right now. */
  #checking = new Set<string>();
  /** Sessions whose turn ended with background work running, and since when. In memory: lost on restart. */
  #background = new Map<string, number>();
  #tmux!: Tmux;
  #binDir: string;
  #restorable = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #restoreGapMs: number;

  constructor(ctx: Context, services: Services, options: SessionsOptions = {}) {
    this.#ctx = ctx;
    this.#services = services;
    this.#launcher = options.launcher ?? defaultLauncher;
    this.#titler = options.titler ?? defaultTitler;
    this.#waitChecker = options.waitChecker ?? defaultWaitChecker;
    this.#restoreGapMs = options.restoreGapMs ?? RESTORE_GAP_MS;
    this.#binDir = join(ctx.paths.stateDir, 'bin');
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
    return this.#rows().map(toSession);
  }

  get(id: string): Session | undefined {
    const row = this.#row(id);
    return row && toSession(row);
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
    const parent = request.kind === 'shell' ? this.require(request.parentId ?? '') : undefined;
    const projectId = request.kind === 'global' ? null : (parent?.projectId ?? request.projectId);
    const project = projectId ? this.#services.config.project(projectId) : undefined;
    if (request.kind === 'claude' && !project) throw new HttpError(404, 'no such project');
    const button = request.buttonId ? project?.buttons.find((b) => b.id === request.buttonId) : undefined;
    if (request.buttonId && !button) throw new HttpError(404, 'no such button');

    const cwd = request.cwd ?? parent?.cwd ?? project?.path ?? homedir();
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new HttpError(400, `no such folder: ${cwd}`);
    const resumeId = request.kind === 'claude' ? request.resumeClaudeSessionId : undefined;
    const resumed = resumeId ? this.#resumable(cwd, resumeId) : undefined;
    const slug = project ? slugify(project.id) : GLOBAL_ID;
    const prefix = request.kind === 'shell' ? `${slug}-sh` : `${slug}-`;
    const n = request.kind === 'global' ? 1 : this.#nextNumber(prefix);
    const id = request.kind === 'global' ? GLOBAL_ID : `${prefix}${n}`;
    const prompt = button ? buttonPrompt(button, request.input) : request.prompt?.trim() || undefined;
    const namePrompt =
      request.name?.trim() || request.kind !== 'claude' || button ? undefined : (prompt ?? resumed?.firstPrompt);
    const name =
      request.name?.trim() ||
      (request.kind === 'global' ? 'Global Claude' : autoName({ button, input: request.input, prompt: namePrompt, n }));

    const at = now();
    this.#db
      .prepare(
        `INSERT INTO sessions (id, kind, project_id, name, cwd, status, claude_session_id, permission_mode, started_by,
         parent_id, links, created_at, last_activity_at, pending_permission, token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        null,
        null,
      );
    try {
      this.#launch(this.#row(id)!, { prompt, resume: !!resumeId });
    } catch (err) {
      const token = this.#row(id)?.token;
      if (token) this.#services.auth.revokeClientToken(token);
      this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      throw err;
    }
    const session = this.get(id)!;
    this.#ctx.bus.emit({ type: 'session.started', session });
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
    void this.#titler(prompt).then((title) => {
      if (title && this.get(id)?.name === quick) this.rename(id, title, 'shub');
    });
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

  #launch(row: Row, opts: { prompt?: string; resume: boolean }): void {
    const env: Record<string, string> = {
      SHUB_URL: `http://127.0.0.1:${this.#ctx.port}`,
      PATH: `${this.#binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    };
    const settingsFile = join(this.#ctx.paths.stateDir, 'sessions', row.id, 'settings.json');
    if (row.kind !== 'shell') {
      mkdirSync(join(settingsFile, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(
        settingsFile,
        JSON.stringify(hookSettings(this.#ctx.paths.appDir, this.#ctx.paths.stateDir), null, 2),
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
      Object.assign(env, { SHUB_SESSION_ID: row.id, SHUB_TOKEN: token });
    }
    const argv = this.#launcher({
      kind: row.kind,
      claudeSessionId: row.claude_session_id,
      settingsFile,
      permissionMode: row.permission_mode,
      prompt: opts.prompt,
      resume: opts.resume,
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
   *  With `check`, a small model looks every `everyMinutes` and ends the wait once it happened. */
  wait(id: string, reason: string | null, actor: string, check?: { prompt: string; everyMinutes?: number }): Session {
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
    if (!clean && session.status === 'waiting') this.setStatus(id, 'your-turn');
    this.#services.permissions.log({
      actor,
      action: clean ? 'session.wait' : 'session.ready',
      detail: `${id}: ${clean ?? session.waitingFor ?? ''}`,
    });
    return this.#emitUpdated(id);
  }

  /** Pins sessions to a place in their project's list (set by drag and drop); null hands one back to the default order. */
  reorder(positions: Record<string, number | null>): Session[] {
    for (const [id, position] of Object.entries(positions)) {
      this.require(id);
      this.#db.prepare('UPDATE sessions SET position = ? WHERE id = ?').run(position, id);
    }
    return Object.keys(positions).map((id) => this.#emitUpdated(id));
  }

  setStatus(
    id: string,
    status: SessionStatus,
    pendingPermission?: Session['pendingPermission'],
    pendingCommands?: Session['pendingCommands'],
    background = false,
  ): void {
    const session = this.get(id);
    if (!session || session.status === 'exited') return;
    if (background) this.#background.set(id, Date.now());
    else this.#background.delete(id);
    const keep = status === 'needs-you';
    const pending = pendingPermission !== undefined ? pendingPermission : keep ? session.pendingPermission : null;
    const commands = pendingCommands !== undefined ? pendingCommands : keep ? session.pendingCommands : null;
    this.#db
      .prepare(
        'UPDATE sessions SET status = ?, pending_permission = ?, pending_commands = ?, last_activity_at = ? WHERE id = ?',
      )
      .run(
        status,
        pending ? JSON.stringify(pending) : null,
        commands?.length ? JSON.stringify(commands) : null,
        now(),
        id,
      );
    this.#ctx.bus.emit({ type: 'session.status', sessionId: id, status });
    this.#emitUpdated(id);
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

  pause(id: string, actor: string): Session {
    const session = this.require(id);
    if (session.kind === 'shell') throw new HttpError(400, 'shells cannot be paused');
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
    const transcript =
      session.claudeSessionId &&
      join(claudeDir(), 'projects', encodeCwd(session.cwd), `${session.claudeSessionId}.jsonl`);
    const hasTranscript = !!transcript && existsSync(transcript);
    this.#launch(this.#row(id)!, { resume: hasTranscript });
    this.#restorable.delete(id);
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
   * A command Claude handed over: "run" types `!` (Claude's bash mode) and pastes it, Enter only when asked;
   * both actions clear the list and hand the turn back.
   */
  answerCommand(id: string, index: number, action: 'run' | 'dismiss', enter = false): void {
    const command = this.get(id)?.pendingCommands?.[index];
    if (command === undefined) throw new HttpError(404, 'no such command waiting');
    if (action === 'run') {
      this.sendKeys(id, ['!']);
      this.pasteText(id, command);
      if (enter) this.sendKeys(id, ['Enter']);
    }
    this.setStatus(id, 'your-turn', null, null);
  }

  pasteText(id: string, text: string): void {
    this.#requireRunning(id);
    if (!text || text.length > TEXT_PASTE_MAX) throw new HttpError(400, 'text must be 1 byte to 1 MB');
    this.#tmux.paste(tmuxName(id), text);
  }

  /** Saves the file under <stateDir>/pastes and pastes its absolute path (Claude picks up image paths). */
  pasteFile(id: string, contentType: string, body: Buffer): string {
    this.#requireRunning(id);
    const ext = PASTE_TYPES[contentType.split(';')[0].trim().toLowerCase()];
    if (!ext) throw new HttpError(415, 'unsupported file type');
    if (body.length === 0 || body.length > FILE_PASTE_MAX) throw new HttpError(413, 'file must be 1 byte to 20 MB');
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
    return listOldSessions(projectId, project.path, live);
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
   *  back sessions whose background work has run past BACKGROUND_FALLBACK_MS. */
  reconcile(at = Date.now()): void {
    for (const [id, since] of this.#background) {
      if (at - since < BACKGROUND_FALLBACK_MS) continue;
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
      const updated = { ...check, checkedAt: now(), last };
      this.#db.prepare('UPDATE sessions SET wait_check = ? WHERE id = ?').run(JSON.stringify(updated), id);
      if (result?.done && current.status === 'waiting') {
        const session = this.wait(id, null, 'shub:wait-check');
        this.#services.notify.needsYou(session, result.summary);
      } else this.#emitUpdated(id);
    } finally {
      this.#checking.delete(id);
    }
  }

  stop(): void {
    clearInterval(this.#timer);
  }
}
