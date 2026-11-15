// The session list and the Claude transcripts of the device group. The list is `session:<claude id>` items (synced
// like every item, see folder.ts); the transcripts (`<claude dir>/projects/<folder>/<id>.jsonl`) go through the same
// sync folder: this host writes its own recent conversations to `transcripts/<project>/<id>.jsonl` there and copies
// the other hosts' into the folder Claude keeps for the project's path on THIS host. A transcript only grows, so
// both directions only append whole lines. The file is not rewritten: `claude --resume` finds it by that folder
// name, and the old path in its entries is harmless (checked with claude 2.1.309: new entries just carry the new cwd).
import { statSync, watch, type FSWatcher } from 'node:fs';
import { appendFile, mkdir, open, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Session, SyncSettings, TranscriptProgress } from '../../shared/api.ts';
import { claudeDir, encodeCwd, UUID } from '../sessions/old.ts';
import { syncOn, type GroupStore } from './index.ts';

/** Own conversations idle for longer than this stay out of the folder: it would grow by every transcript ever. */
const EXPORT_DAYS = 7;
const WATCH_DELAY_MS = 1000;

/** The body of a `session:<claude id>` item. `rel` is the session's folder below its project, "" for the project itself. */
export interface SessionItem {
  claudeSessionId: string;
  projectId: string;
  rel: string;
  name: string;
  lastAt: string;
  hostId: string;
  host: string;
  /** The owner's Claude process is up (not paused or exited). Missing in items of older hosts. */
  running?: boolean;
  /** The owner's machine shut down with this conversation open: another host may pick it up (see handovers). */
  released?: boolean;
  /** Bytes of the owner's transcript: the offset a copy elsewhere has to reach before a resume is safe. */
  size?: number;
}

/**
 * Why `claudeSessionId` may not be resumed in place on this host, if the group says so: its owner runs it, or this
 * host's copy of the transcript is behind the owner's. `localSize` is this host's copy (0 when none). `takeOver`
 * skips the check: the user knows the owner is done with it.
 */
export function resumeGuard(
  group: GroupStore,
  claudeSessionId: string,
  localSize: number,
  takeOver = false,
): string | undefined {
  const owner = remoteSessions(group).find((r) => r.claudeSessionId === claudeSessionId);
  if (!owner || takeOver) return undefined;
  if (owner.running) return `that conversation is running on ${owner.host}: fork it, or take it over`;
  if (localSize < (owner.size ?? 0))
    return `the copy here is behind ${owner.host} (${localSize} of ${owner.size} bytes): wait for the sync, fork, or take over`;
}

/** The user took the conversation over: this host owns it from now on, the old owner's item is replaced on sync. */
export function claimSession(group: GroupStore, claudeSessionId: string, host: string): void {
  const key = `session:${claudeSessionId}`;
  const have = group.get(key)?.body as SessionItem | null | undefined;
  if (have && have.hostId !== group.hostId) group.put(key, { ...have, hostId: group.hostId, host, running: true });
}

/** Our running Claude sessions whose conversation another host has claimed since: only one process may write it. */
export function takenOver(group: GroupStore, sessions: Session[]): Session[] {
  const gone = new Set(remoteSessions(group).map((r) => r.claudeSessionId));
  return sessions.filter(
    (s) =>
      s.kind === 'claude' &&
      s.claudeSessionId &&
      gone.has(s.claudeSessionId) &&
      !['paused', 'exited'].includes(s.status),
  );
}

/**
 * Conversations another host released at its shutdown that this host can pick up now: the project is here and the
 * copy of the transcript is whole. `localSize(project, id)` is the bytes of this host's copy.
 */
export function handovers(
  group: GroupStore,
  projects: { id: string; path: string }[],
  localSize: (projectPath: string, id: string) => number,
): (SessionItem & { cwd: string })[] {
  return remoteSessions(group).flatMap((r) => {
    const project = projects.find((p) => p.id === r.projectId);
    // ponytail: only the project's own folder; a transcript of a subfolder lands in the project's folder here
    if (!r.released || r.rel !== '' || !project || localSize(project.path, r.claudeSessionId) < (r.size ?? 0))
      return [];
    return [{ ...r, cwd: project.path }];
  });
}

/**
 * Append the whole lines of `src` that `dst` lacks (a transcript only grows). A half-written last line waits for the
 * next call. Returns the bytes added.
 */
export async function pump(src: string, dst: string): Promise<number> {
  const want = (await stat(src).catch(() => null))?.size ?? 0;
  const have = (await stat(dst).catch(() => null))?.size ?? 0;
  if (have >= want) return 0;
  const file = await open(src, 'r').catch(() => undefined);
  if (!file) return 0;
  try {
    let buf = Buffer.alloc(want - have);
    await file.read(buf, 0, buf.length, have);
    buf = buf.subarray(0, buf.lastIndexOf(10) + 1);
    if (!buf.length) return 0;
    await mkdir(join(dst, '..'), { recursive: true });
    await appendFile(dst, buf);
    return buf.length;
  } finally {
    await file.close();
  }
}

export interface TranscriptDeps {
  /** The sync folder of this host, if one is set. */
  folder(): string | undefined;
  sync(): SyncSettings | undefined;
  /** The projects with their paths on this host. */
  projects(): { id: string; path: string }[];
  sessions(): Session[];
  hostName: string;
  root?: string;
}

export class Transcripts {
  #group: GroupStore;
  #deps: TranscriptDeps;
  #watchers = new Map<string, FSWatcher>();
  #debounce?: ReturnType<typeof setTimeout>;
  #busy?: Promise<void>;

  constructor(group: GroupStore, deps: TranscriptDeps) {
    this.#group = group;
    this.#deps = deps;
  }

  #dir(path: string): string {
    return join(this.#deps.root ?? claudeDir(), 'projects', encodeCwd(path));
  }

  /** Where a conversation sits in the sync folder. */
  #shared(project: string, id: string): string | undefined {
    const folder = this.#deps.folder();
    return folder && join(folder, 'transcripts', encodeURIComponent(project), `${id}.jsonl`);
  }

  // ---------- the session list ----------

  /** Put this host's Claude sessions into the group; an item another host made is never overwritten. */
  publishSessions(): void {
    const projects = this.#deps.projects();
    const live = this.#deps.sessions();
    // Ours that are gone (closed or exited) stop saying they run, or the other hosts refuse to resume them.
    for (const i of this.#group.list()) {
      const b = i.body as SessionItem;
      if (i.deleted || !i.key.startsWith('session:') || b.hostId !== this.#group.hostId || !b.running) continue;
      if (!live.some((s) => s.claudeSessionId === b.claudeSessionId)) this.#group.put(i.key, { ...b, running: false });
    }
    for (const s of live) {
      const project = projects.find((p) => p.id === s.projectId);
      if (s.kind !== 'claude' || !s.claudeSessionId || !project) continue;
      const rel = relative(project.path, s.cwd);
      if (rel.startsWith('..')) continue;
      const key = `session:${s.claudeSessionId}`;
      const have = this.#group.get(key)?.body as SessionItem | null | undefined;
      if (have && have.hostId !== this.#group.hostId) continue;
      const body: SessionItem = {
        claudeSessionId: s.claudeSessionId,
        projectId: project.id,
        rel,
        name: s.name,
        lastAt: s.lastActivityAt,
        hostId: this.#group.hostId,
        host: this.#deps.hostName,
        running: s.status !== 'paused' && s.status !== 'exited',
        // Claude keeps the transcript in the folder of the session's own cwd, a subfolder's included.
        size: statSync(join(this.#dir(s.cwd), `${s.claudeSessionId}.jsonl`), { throwIfNoEntry: false })?.size ?? 0,
      };
      if (JSON.stringify(have) !== JSON.stringify(body)) this.#group.put(key, body);
    }
  }

  /**
   * The machine is shutting down: the sessions still running are not going to run any more. Publish their final
   * size and mark them released so another host resumes them, then write the transcripts to the sync folder.
   * Returns whether anything was released (the caller then gives the sync tool a moment to carry it off).
   */
  async release(): Promise<boolean> {
    this.publishSessions();
    let any = false;
    for (const i of this.#group.list()) {
      const b = i.body as SessionItem;
      if (i.deleted || !i.key.startsWith('session:') || b.hostId !== this.#group.hostId || !b.running) continue;
      this.#group.put(i.key, { ...b, running: false, released: true });
      any = true;
    }
    await this.sync();
    return any;
  }

  /**
   * Near-live: a transcript only grows, so when one of ours does, the new size goes into the session item and the new
   * lines into the sync folder at once. Idempotent: call it again after projects changed.
   */
  watch(): void {
    for (const p of this.#deps.projects()) {
      const dir = this.#dir(p.path);
      if (this.#watchers.has(dir)) continue;
      try {
        const w = watch(dir, (_event, name) => {
          if (!name?.endsWith('.jsonl')) return;
          // Throttle, not debounce: a transcript that grows all the time must still publish every second.
          if (this.#debounce) return;
          this.#debounce = setTimeout(() => {
            this.#debounce = undefined;
            this.publishSessions();
            void this.sync();
          }, WATCH_DELAY_MS);
          this.#debounce.unref();
        });
        w.on('error', () => this.#watchers.delete(dir));
        this.#watchers.set(dir, w);
      } catch {
        // no folder yet: the next call tries again
      }
    }
  }

  unwatch(): void {
    clearTimeout(this.#debounce);
    this.#debounce = undefined;
    this.#watchers.forEach((w) => w.close());
    this.#watchers.clear();
  }

  // ---------- through the sync folder ----------

  /** Both directions; one run at a time, a call during a run goes once more after it. */
  sync(): Promise<void> {
    if (this.#busy) return this.#busy.then(() => this.#run());
    this.#busy = this.#run().finally(() => (this.#busy = undefined));
    return this.#busy;
  }

  async #run(): Promise<void> {
    if (!syncOn(this.#deps.sync(), 'transcripts')) return;
    const projects = this.#deps.projects();
    const since = new Date(Date.now() - EXPORT_DAYS * 86_400_000).toISOString();
    for (const i of this.#group.list()) {
      const b = i.body as SessionItem | null;
      if (i.deleted || !b || !i.key.startsWith('session:') || b.rel !== '' || !UUID.test(b.claudeSessionId)) continue;
      const project = projects.find((p) => p.id === b.projectId);
      const shared = this.#shared(b.projectId, b.claudeSessionId);
      if (!project || !shared) continue;
      const local = join(this.#dir(project.path), `${b.claudeSessionId}.jsonl`);
      try {
        if (b.hostId === this.#group.hostId) {
          if (b.lastAt >= since || b.running) await pump(local, shared);
        } else await pump(shared, local);
      } catch {
        // folder gone or full: the next run tries again
      }
    }
  }

  /** Bytes of this host's copy of a conversation of `projectPath`. */
  localSize(projectPath: string, id: string): number {
    return statSync(join(this.#dir(projectPath), `${id}.jsonl`), { throwIfNoEntry: false })?.size ?? 0;
  }

  async progress(): Promise<TranscriptProgress> {
    let size = 0;
    for (const p of this.#deps.projects()) {
      const dir = this.#dir(p.path);
      for (const name of await readdir(dir).catch(() => [] as string[]))
        if (name.endsWith('.jsonl')) size += (await stat(join(dir, name)).catch(() => null))?.size ?? 0;
    }
    return { running: false, done: 0, total: 0, size };
  }
}

/** The sessions other hosts put into the group. */
export function remoteSessions(group: GroupStore): SessionItem[] {
  return group
    .list()
    .filter((i) => !i.deleted && i.key.startsWith('session:') && (i.body as SessionItem).hostId !== group.hostId)
    .map((i) => i.body as SessionItem);
}
