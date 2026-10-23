// The session list and the Claude transcripts of the device group. The list is `session:<claude id>` items; the
// transcripts (`<claude dir>/projects/<folder>/<id>.jsonl`) are copied in the background from every other host.
// Only the folder of a synced project travels: the copy lands in the folder Claude keeps for the project's path on
// THIS host. The file is not rewritten: `claude --resume` finds it by that folder name, and the old path in its
// entries is harmless (checked with claude 2.1.309: new entries just carry the new cwd).
import { appendFile, copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import type { HostPeer, Session, SyncSettings, TranscriptEntry, TranscriptProgress } from '../../shared/api.ts';
import { HttpError } from '../api/router.ts';
import { claudeDir, encodeCwd } from '../sessions/old.ts';
import { syncOn, type GroupStore } from './index.ts';

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);
const CHUNK = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body of a `session:<claude id>` item. `rel` is the session's folder below its project, "" for the project itself. */
export interface SessionItem {
  claudeSessionId: string;
  projectId: string;
  rel: string;
  name: string;
  lastAt: string;
  hostId: string;
  host: string;
}

/** What the transcript sync needs from the host link; HostSync is one. */
interface Link {
  peers(): HostPeer[];
  call(peer: HostPeer, action: 'manifest' | 'chunk', body: unknown): Promise<any>;
}

export interface TranscriptDeps {
  sync(): SyncSettings | undefined;
  /** The projects with their paths on this host. */
  projects(): { id: string; path: string }[];
  sessions(): Session[];
  hostName: string;
  root?: string;
}

export class Transcripts {
  #group: GroupStore;
  #link: Link;
  #deps: TranscriptDeps;
  #progress = { running: false, done: 0, total: 0 };

  constructor(group: GroupStore, link: Link, deps: TranscriptDeps) {
    this.#group = group;
    this.#link = link;
    this.#deps = deps;
  }

  #dir(path: string): string {
    return join(this.#deps.root ?? claudeDir(), 'projects', encodeCwd(path));
  }

  // ---------- the session list ----------

  /** Put this host's Claude sessions into the group; an item another host made is never overwritten. */
  publishSessions(): void {
    const projects = this.#deps.projects();
    for (const s of this.#deps.sessions()) {
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
      };
      if (JSON.stringify(have) !== JSON.stringify(body)) this.#group.put(key, body);
    }
  }

  // ---------- serving the other hosts ----------

  async serve(action: 'manifest' | 'chunk', body: Record<string, unknown>): Promise<unknown> {
    // Off here means nothing leaves this host.
    if (!syncOn(this.#deps.sync(), 'transcripts')) throw new HttpError(403, 'transcripts are not synced here');
    return action === 'manifest' ? { entries: await this.#manifest() } : this.#chunk(body);
  }

  async #manifest(): Promise<TranscriptEntry[]> {
    const entries: TranscriptEntry[] = [];
    for (const p of this.#deps.projects()) {
      const dir = this.#dir(p.path);
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const id = name.slice(0, -'.jsonl'.length);
        if (!name.endsWith('.jsonl') || !UUID.test(id)) continue;
        entries.push({ project: p.id, id, size: (await stat(join(dir, name))).size });
      }
    }
    return entries;
  }

  /** Bytes from `offset`, zstd-compressed. At the end of the file only whole lines go, a half-written one waits. */
  async #chunk(body: Record<string, unknown>): Promise<{ data: string; end: number }> {
    const project = this.#deps.projects().find((p) => p.id === body.project);
    const { id, offset } = body;
    if (!project || typeof id !== 'string' || !UUID.test(id) || !Number.isInteger(offset) || (offset as number) < 0)
      throw new HttpError(400, 'bad chunk request');
    const from = offset as number;
    const file = await open(join(this.#dir(project.path), `${id}.jsonl`), 'r').catch(() => undefined);
    if (!file) throw new HttpError(404, 'no such transcript');
    try {
      const { size } = await file.stat();
      let buf = Buffer.alloc(Math.max(0, Math.min(CHUNK, size - from)));
      await file.read(buf, 0, buf.length, from);
      if (from + buf.length === size && buf.length) buf = buf.subarray(0, buf.lastIndexOf(10) + 1);
      return { data: (await compress(buf)).toString('base64'), end: from + buf.length };
    } finally {
      await file.close();
    }
  }

  // ---------- copying from the other hosts ----------

  /** Copy what is new or grown from every reachable host. One run at a time; an interrupted one resumes next time. */
  async run(): Promise<void> {
    if (this.#progress.running || !syncOn(this.#deps.sync(), 'transcripts')) return;
    this.#progress = { running: true, done: 0, total: 0 };
    try {
      for (const peer of this.#link.peers().filter((p) => p.url)) {
        try {
          const { entries } = (await this.#link.call(peer, 'manifest', {})) as { entries: TranscriptEntry[] };
          for (const e of entries) await this.#copy(peer, e);
        } catch {
          // offline, or it has transcripts switched off: next round
        }
      }
    } finally {
      this.#progress.running = false;
    }
  }

  async #copy(peer: HostPeer, e: TranscriptEntry): Promise<void> {
    const project = this.#deps.projects().find((p) => p.id === e.project);
    if (!project || !UUID.test(e.id) || !(await stat(project.path).catch(() => null))?.isDirectory()) return;
    const dir = this.#dir(project.path);
    const file = join(dir, `${e.id}.jsonl`);
    const part = `${file}.part`;
    const have = (await stat(file).catch(() => null))?.size ?? 0;
    // ponytail: a transcript only grows, so a bigger or equal local file counts as complete; a file changed
    // in place on both hosts is not detected. Hash the head too if that ever happens.
    if (have >= e.size) return;
    await mkdir(dir, { recursive: true });
    // Work on a side file: the plain .jsonl is only ever a whole transcript, and an interruption leaves the
    // .part to continue from. A grown file starts from its current copy.
    if (!(await stat(part).catch(() => null))) {
      if (have) await copyFile(file, part);
      else await appendFile(part, '');
    }
    let offset = (await stat(part)).size;
    if (offset > e.size) return void (await rm(part));
    this.#progress.total += e.size - offset;
    while (offset < e.size) {
      const res = (await this.#link.call(peer, 'chunk', { project: e.project, id: e.id, offset })) as {
        data: string;
        end: number;
      };
      if (!(res.end > offset)) break; // the rest is a line still being written
      const buf = await decompress(Buffer.from(res.data, 'base64'));
      if (buf.length !== res.end - offset) throw new Error('chunk length mismatch');
      await appendFile(part, buf);
      offset = res.end;
      this.#progress.done += buf.length;
    }
    if (offset > have) await rename(part, file);
    else await rm(part);
  }

  async progress(): Promise<TranscriptProgress> {
    let size = 0;
    for (const p of this.#deps.projects()) {
      const dir = this.#dir(p.path);
      for (const name of await readdir(dir).catch(() => [] as string[]))
        if (name.endsWith('.jsonl')) size += (await stat(join(dir, name)).catch(() => null))?.size ?? 0;
    }
    return { ...this.#progress, size };
  }
}

/** The sessions other hosts put into the group. */
export function remoteSessions(group: GroupStore): SessionItem[] {
  return group
    .list()
    .filter((i) => !i.deleted && i.key.startsWith('session:') && (i.body as SessionItem).hostId !== group.hostId)
    .map((i) => i.body as SessionItem);
}
