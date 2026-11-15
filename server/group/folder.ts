// Sync of the shared items (settings, projects, themes, the session list) through a plain folder. shub only reads
// and writes files there; whatever syncs the folder between the machines (Syncthing, Google Drive, Dropbox, git, a
// NAS) does the transport, so no machine has to be on when another one is. One file per item, `items/<key>.json`,
// holding the whole item with its version vector: the store's merge settles which side is newer and parks a real
// conflict. Devices never go through the folder: a leaked folder must not admit a device (docs/SECURITY.md).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { SyncSettings } from '../../shared/api.ts';
import { categoryOf, forSync, kindOf, syncOn, type GroupItem, type GroupStore } from './index.ts';

export const SCAN_MS = 60_000;
const WRITE_DELAY_MS = 300;
const SCAN_DELAY_MS = 500;

export interface FolderDeps {
  /** The sync folder of this machine (local.json); read per call, the user can change it any time. */
  folder(): string | undefined;
  sync(): SyncSettings | undefined;
  /** Items from the folder were merged: reload what is built from them. */
  onMerged(): void;
  /** After every scan: the work that needs the folder's new files (transcript copy, picking up sessions). */
  onScan?(): void | Promise<void>;
}

export interface FolderStatus {
  folder?: string;
  /** The folder cannot be read or written. */
  error?: string;
  items: number;
  /** When the last scan finished. */
  scannedAt?: string;
  conflicts: number;
}

const fileOf = (dir: string, key: string): string => join(dir, `${encodeURIComponent(key)}.json`);

export class FolderSync {
  #group: GroupStore;
  #deps: FolderDeps;
  #dirty = new Set<string>();
  #seen = new Map<string, string>(); // file -> "mtime:size" of the last read, to skip what did not change
  #watched?: { dir: string; watcher: FSWatcher };
  #write?: ReturnType<typeof setTimeout>;
  #scan?: ReturnType<typeof setTimeout>;
  #timer?: ReturnType<typeof setInterval>;
  #status: FolderStatus = { items: 0, conflicts: 0 };

  constructor(group: GroupStore, deps: FolderDeps) {
    this.#group = group;
    this.#deps = deps;
    group.onChange((key) => {
      this.#dirty.add(key);
      if (this.#write) return;
      this.#write = setTimeout(() => {
        this.#write = undefined;
        this.flush();
      }, WRITE_DELAY_MS);
      this.#write.unref();
    });
  }

  #dir(): string | undefined {
    const folder = this.#deps.folder();
    return folder && join(folder, 'items');
  }

  start(): void {
    this.scan();
    this.#timer = setInterval(() => this.scan(), SCAN_MS);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
    clearTimeout(this.#write);
    clearTimeout(this.#scan);
    this.#write = this.#scan = undefined;
    this.#watched?.watcher.close();
    this.#watched = undefined;
  }

  status(): FolderStatus {
    return { ...this.#status, folder: this.#deps.folder(), conflicts: this.#group.conflicts().length };
  }

  /** Write the changed items (all of them when `all`) that this machine is willing to share. */
  flush(all = false): void {
    const dir = this.#dir();
    const keys = all ? this.#group.list().map((i) => i.key) : [...this.#dirty];
    this.#dirty.clear();
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const sync = this.#deps.sync();
      for (const key of keys) {
        const item = this.#group.get(key);
        const out = item && kindOf(key) !== 'device' ? forSync(item, sync) : null;
        if (!out) continue;
        const file = fileOf(dir, key);
        const text = JSON.stringify(out);
        if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
        // Whole file or none: the other machine's sync tool must never pick up half an item.
        writeFileSync(`${file}.tmp`, text);
        renameSync(`${file}.tmp`, file);
      }
      this.#status.error = undefined;
    } catch (err) {
      this.#status.error = (err as Error).message;
    }
  }

  /** Read every item file that is new or changed and merge it; then write what the folder lacks. */
  scan(): void {
    const dir = this.#dir();
    if (!dir) return void (this.#status = { items: 0, conflicts: 0 });
    let changed = 0;
    let conflicts = 0;
    try {
      mkdirSync(dir, { recursive: true });
      this.#watch(dir);
      const sync = this.#deps.sync();
      const names = readdirSync(dir).filter((n) => n.endsWith('.json'));
      for (const name of names) {
        const file = join(dir, name);
        const st = statSync(file, { throwIfNoEntry: false });
        if (!st) continue;
        const stamp = `${st.mtimeMs}:${st.size}`;
        if (this.#seen.get(file) === stamp) continue;
        this.#seen.set(file, stamp);
        const order = this.#take(readFileSync(file, 'utf8'), sync);
        if (order === 'newer') changed++;
        if (order === 'conflict') conflicts++;
        // A copy a sync tool set aside (Syncthing `.sync-conflict-`): its version is merged now, the file is done.
        if (name.includes('.sync-conflict-') && order) unlinkSync(file);
      }
      this.#status.items = names.length;
      this.#status.error = undefined;
    } catch (err) {
      this.#status.error = (err as Error).message;
    }
    this.#status.scannedAt = new Date().toISOString();
    this.flush(true); // what the folder lacks (first start, a new folder)
    if (changed || conflicts) this.#deps.onMerged();
    void this.#deps.onScan?.();
  }

  /** Merge one item file; returns how it compares to ours, undefined when it is not a valid shareable item. */
  #take(text: string, sync: SyncSettings | undefined): ReturnType<GroupStore['merge']> | undefined {
    let raw: GroupItem;
    try {
      raw = JSON.parse(text);
    } catch {
      return; // half written by a sync tool: the next scan sees the whole file
    }
    const valid =
      typeof raw?.key === 'string' &&
      raw.key.includes(':') &&
      kindOf(raw.key) !== 'device' &&
      typeof raw.deleted === 'boolean' &&
      raw.version &&
      Object.values(raw.version).every((n) => Number.isInteger(n));
    if (!valid) return;
    let item = forSync(raw, sync);
    if (!item) return;
    // The writer's plugin has no env (switched off here): the env we have stays.
    const ours = this.#group.get(item.key)?.body as { env?: unknown } | null | undefined;
    if (categoryOf(item.key) === 'plugins' && !syncOn(sync, 'pluginEnv') && ours?.env && item.body)
      item = { ...item, body: { ...(item.body as object), env: ours.env } };
    return this.#group.merge(item);
  }

  #watch(dir: string): void {
    if (this.#watched?.dir === dir) return;
    this.#watched?.watcher.close();
    this.#watched = undefined;
    try {
      const watcher = watch(dir, () => {
        if (this.#scan) return;
        this.#scan = setTimeout(() => {
          this.#scan = undefined;
          this.scan();
        }, SCAN_DELAY_MS);
        this.#scan.unref();
      });
      watcher.unref();
      watcher.on('error', () => (this.#watched = undefined));
      this.#watched = { dir, watcher };
    } catch {
      // the minute timer still scans
    }
  }
}
