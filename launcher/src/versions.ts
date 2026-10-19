// App versions side by side: <home>/versions/<version>/, <home>/current -> versions/<version>.
// <home>/launcher.json remembers the previous version and the last update result (the app shows it in Settings).
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { compareVersions, isVersion } from './releases.ts';

export function shubHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHUB_HOME ?? join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'shub');
}

/** Read by the app (server/updates); keep the field names stable. */
export interface LauncherState {
  previous?: string;
  /** Port the app was last started on, for the health check after an update. */
  port?: number;
  last?: { at: string; from: string | null; to: string; ok: boolean; message: string };
}

export const versionDir = (home: string, version: string): string => join(home, 'versions', version);

export function currentVersion(home: string): string | null {
  try {
    return basename(readlinkSync(join(home, 'current')));
  } catch {
    return null;
  }
}

export function installedVersions(home: string): string[] {
  const dir = join(home, 'versions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isVersion)
    .sort((a, b) => compareVersions(b, a));
}

export function readState(home: string): LauncherState {
  try {
    return JSON.parse(readFileSync(join(home, 'launcher.json'), 'utf8')) as LauncherState;
  } catch {
    return {};
  }
}

export function writeState(home: string, patch: Partial<LauncherState>): LauncherState {
  const next = { ...readState(home), ...patch };
  const file = join(home, 'launcher.json');
  mkdirSync(home, { recursive: true });
  writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(next, null, 2) + '\n');
  renameSync(`${file}.${process.pid}.tmp`, file);
  return next;
}

/** Points `current` at an installed version in one rename, so a reader never sees a missing link. */
export function switchTo(home: string, version: string): void {
  if (!existsSync(versionDir(home, version))) throw new Error(`version ${version} is not installed`);
  const tmp = join(home, `current.${process.pid}.tmp`);
  rmSync(tmp, { force: true });
  symlinkSync(join('versions', version), tmp);
  renameSync(tmp, join(home, 'current'));
}

/** Keeps current, previous and the newest others, three in all (the last two plus current); returns the removed. */
export function prune(home: string): string[] {
  const pinned = new Set([currentVersion(home), readState(home).previous].filter((v) => !!v));
  const removed = installedVersions(home)
    .filter((v) => !pinned.has(v))
    .slice(Math.max(0, 3 - pinned.size));
  for (const v of removed) rmSync(versionDir(home, v), { recursive: true, force: true });
  return removed;
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One update at a time; a lock left by a dead process is taken over. */
export function lock(home: string): () => void {
  mkdirSync(home, { recursive: true });
  const file = join(home, 'update.lock');
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch {
    const pid = Number(readFileSync(file, 'utf8'));
    if (pid > 0 && pid !== process.pid && running(pid)) throw new Error(`another update is running (pid ${pid})`);
    writeFileSync(file, String(process.pid));
  }
  return () => rmSync(file, { force: true });
}
