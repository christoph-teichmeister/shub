// First-run suggestions from Claude Code's history in ~/.claude/projects.
// Each folder there is a cwd with "/" and "." replaced by "-"; the jsonl transcripts carry the real cwd.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Visibility } from '../../shared/api.ts';

export interface ImportCandidate {
  path: string;
  name: string;
  sessions: number;
  lastUsedAt: string;
  suggested: Visibility;
}

const PINNED_WINDOW_MS = 14 * 24 * 3600 * 1000;
const READ_BYTES = 64 * 1024;

function readSlice(file: string, fromEnd: boolean): string {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const length = Math.min(size, READ_BYTES);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, fromEnd ? size - length : 0);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The cwd field of the newest line that has one; the first line of a slice may be cut off and is skipped by JSON.parse. */
export function cwdFromTranscript(file: string): string | null {
  for (const fromEnd of [true, false]) {
    const lines = readSlice(file, fromEnd).split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(line).cwd;
        if (typeof cwd === 'string' && cwd.startsWith('/')) return cwd;
      } catch {
        // partial line at the slice edge
      }
    }
  }
  return null;
}

/** Worktrees of a project count as the project itself. */
export function mainProjectPath(cwd: string): string {
  return cwd.replace(/\/(?:\.claude\/worktrees|\.worktrees)\/[^/]+(?:\/.*)?$/, '');
}

export function importCandidates(
  claudeProjectsDir = join(homedir(), '.claude', 'projects'),
  known: Set<string> = new Set(),
  now = Date.now(),
): ImportCandidate[] {
  const merged = new Map<string, { sessions: number; lastUsed: number }>();
  let folders: string[];
  try {
    folders = readdirSync(claudeProjectsDir);
  } catch {
    return [];
  }
  for (const folder of folders) {
    const dir = join(claudeProjectsDir, folder);
    const transcripts = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => ({ file: join(dir, e.name), mtime: statSync(join(dir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (transcripts.length === 0) continue;
    // ponytail: the "-"→"/" fallback is lossy for names with dashes; only used when no transcript has a cwd.
    const cwd = cwdFromTranscript(transcripts[0].file) ?? folder.replace(/-/g, '/');
    const path = mainProjectPath(cwd);
    if (known.has(path) || !existsSync(path)) continue;
    const entry = merged.get(path) ?? { sessions: 0, lastUsed: 0 };
    entry.sessions += transcripts.length;
    entry.lastUsed = Math.max(entry.lastUsed, transcripts[0].mtime);
    merged.set(path, entry);
  }
  return [...merged]
    .map(([path, e]) => ({
      path,
      name: path === homedir() ? '~' : basename(path),
      sessions: e.sessions,
      lastUsedAt: new Date(e.lastUsed).toISOString(),
      suggested: (now - e.lastUsed <= PINNED_WINDOW_MS ? 'pinned' : 'dormant') as Visibility,
    }))
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}
