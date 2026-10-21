// Worktrees a Claude session created (git worktree add, EnterWorktree, an Agent with isolation "worktree").
// The sidebar shows them under that session; a click starts or resumes Claude there.
// `origin_session_id` is no parent: closing the creator leaves these rows alone.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { StateDb } from '../services.ts';
import { claudeDir, encodeCwd } from '../sessions/old.ts';
import { defaultBases, listWorktrees } from './worktrees.ts';

const run = promisify(execFile);
const git = async (dir: string, ...args: string[]) =>
  (await run('git', ['-C', dir, ...args], { timeout: 20_000 })).stdout.trim();

export const CHILD_MIGRATIONS = [
  `CREATE TABLE session_worktrees (
     worktree_path TEXT PRIMARY KEY, origin_session_id TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL,
     head_at_creation TEXT NOT NULL, in_default_at_creation INTEGER NOT NULL)`,
];

export interface ChildRow {
  worktree_path: string;
  origin_session_id: string;
  project_id: string | null;
  created_at: string;
  head_at_creation: string;
  in_default_at_creation: number;
}

/** What a PostToolUse names: a worktree path, or (a background Agent) the agent whose worktree to look up. */
export type Candidate = { path: string } | { agentId: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Options of `git worktree add` that take a value. */
const VALUE_OPTIONS = new Set(['-b', '-B', '--reason']);

/** Splits a shell line into words; quotes are honoured, everything fancier is not. */
function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Paths `git worktree add` created in a Bash command, resolved against `cwd` (a leading `cd` and `-C` count). */
export function worktreeAddPaths(command: string, cwd: string): string[] {
  const found: string[] = [];
  let dir = cwd;
  for (const part of command.split(/&&|\|\||;|\n|\|/)) {
    const w = words(part.trim());
    if (w[0] === 'cd' && w[1]) dir = resolve(dir, w[1]);
    if (w[0] !== 'git') continue;
    let i = 1;
    let gitDir = dir;
    while (w[i]?.startsWith('-')) {
      if (w[i] === '-C' && w[i + 1]) gitDir = resolve(gitDir, w[++i]);
      i++;
    }
    if (w[i] !== 'worktree' || w[i + 1] !== 'add') continue;
    for (let j = i + 2; j < w.length; j++) {
      if (VALUE_OPTIONS.has(w[j])) j++;
      else if (!w[j].startsWith('-')) {
        found.push(resolve(gitDir, w[j]));
        break;
      }
    }
  }
  return found;
}

/** The worktrees a PostToolUse payload says the session created or entered. */
export function childCandidates(payload: Obj): Candidate[] {
  const input = obj(payload.tool_input);
  const response = obj(payload.tool_response);
  const cwd = str(payload.cwd) ?? '/';
  switch (payload.tool_name) {
    case 'Bash': {
      const command = str(input.command);
      return command ? worktreeAddPaths(command, cwd).map((path) => ({ path })) : [];
    }
    case 'EnterWorktree': {
      const path = str(response.worktreePath);
      return path ? [{ path }] : [];
    }
    case 'Agent':
    case 'Task': {
      if (input.isolation !== 'worktree') return [];
      // A finished agent names its worktree (absent when Claude removed it unchanged); a background one
      // only says which agent it is, and Claude names the worktree `agent-<id>`.
      const path = str(response.worktreePath);
      if (path) return [{ path }];
      const agentId = str(response.agentId);
      return agentId ? [{ agentId }] : [];
    }
    default:
      return [];
  }
}

/** Whether origin's default branch already contains `head`. */
export async function inDefault(dir: string, head: string): Promise<boolean> {
  for (const base of await defaultBases(dir).catch(() => [])) {
    const ok = await git(dir, 'merge-base', '--is-ancestor', head, base).then(
      () => true,
      () => false,
    );
    if (ok) return true;
  }
  return false;
}

/**
 * Stores the worktrees a hook names, once each (first sight wins), when `git worktree list` knows them.
 * Records HEAD and whether origin's default branch already contains it, for the merged rule. Returns the new ones.
 */
export async function recordChildren(
  state: StateDb,
  originSessionId: string,
  projects: { id: string; path: string }[],
  payload: Obj,
): Promise<string[]> {
  const candidates = childCandidates(payload);
  if (!candidates.length) return [];
  const cwd = str(payload.cwd) ?? '/';
  const found: { path: string; projectId: string | null }[] = [];
  for (const c of candidates) {
    // A new worktree lists its own repo, which need not be the session's.
    const trees = (await listWorktrees('path' in c ? c.path : cwd)).map((w) => w.path);
    const [main] = trees;
    const path =
      'path' in c ? trees.find((t) => t === resolve(c.path)) : trees.find((t) => basename(t) === `agent-${c.agentId}`);
    if (path && path !== main) found.push({ path, projectId: projects.find((p) => p.path === main)?.id ?? null });
  }
  const insert = state.db.prepare(
    `INSERT OR IGNORE INTO session_worktrees
       (worktree_path, origin_session_id, project_id, created_at, head_at_creation, in_default_at_creation)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const added: string[] = [];
  for (const { path, projectId } of found) {
    const head = await git(path, 'rev-parse', 'HEAD').catch(() => '');
    if (!head) continue;
    const first = (await inDefault(path, head)) ? 1 : 0;
    if (insert.run(path, originSessionId, projectId, new Date().toISOString(), head, first).changes) added.push(path);
  }
  return added;
}

export function childRows(state: StateDb): ChildRow[] {
  return state.db.prepare('SELECT * FROM session_worktrees ORDER BY created_at').all() as unknown as ChildRow[];
}

export function forgetChild(state: StateDb, path: string): void {
  state.db.prepare('DELETE FROM session_worktrees WHERE worktree_path = ?').run(path);
}

/** A headless run still writes its transcript for this long after its last line. */
export const BUSY_MS = 60_000;

/** The newest Claude conversation kept for a folder, skipping ones a live session holds. */
export function newestTranscript(
  cwd: string,
  skip: Set<string>,
  root = claudeDir(),
): { claudeSessionId: string; mtime: number } | null {
  const dir = join(root, 'projects', encodeCwd(cwd));
  let best: { claudeSessionId: string; mtime: number } | null = null;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const claudeSessionId = name.slice(0, -'.jsonl'.length);
    if (skip.has(claudeSessionId)) continue;
    const mtime = statSync(join(dir, name), { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (!best || mtime > best.mtime) best = { claudeSessionId, mtime };
  }
  return best;
}

/** Working folders of running `claude` processes (Linux /proc; empty elsewhere). */
export function claudeCwds(): Set<string> {
  const cwds = new Set<string>();
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((p) => /^\d+$/.test(p));
  } catch {
    return cwds;
  }
  for (const pid of pids) {
    try {
      if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'claude') cwds.add(readlinkSync(`/proc/${pid}/cwd`));
    } catch {
      // gone meanwhile, or another user's
    }
  }
  return cwds;
}
