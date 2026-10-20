// Git worktrees of a project folder: the list for buttons that ask "pick-worktree", and the
// cleanup overview (state per worktree, remove, prune).
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { Worktree, WorktreeInfo, WorktreeState } from '../../shared/api.ts';

const run = promisify(execFile);
const git = async (dir: string, ...args: string[]) =>
  (await run('git', ['-C', dir, ...args], { timeout: 20_000 })).stdout.trim();

interface Entry {
  path: string;
  head: string;
  branch: string; // short name, "" when detached
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

function parseEntries(porcelain: string): Entry[] {
  return porcelain
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n');
      const value = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
      const has = (key: string) => lines.some((l) => l === key || l.startsWith(`${key} `));
      return {
        path: value('worktree') ?? '',
        head: value('HEAD') ?? '',
        branch: (value('branch') ?? '').replace(/^refs\/heads\//, ''),
        bare: has('bare'),
        locked: has('locked'),
        prunable: has('prunable'),
      };
    })
    .filter((e) => e.path);
}

/** Parses `git worktree list --porcelain`; bare and prunable (folder gone) entries are left out. */
export function parseWorktrees(porcelain: string): Worktree[] {
  return parseEntries(porcelain)
    .filter((e) => !e.bare && !e.prunable)
    .map(({ path, branch }) => ({ path, branch }));
}

/** Empty when the folder is no git repository (or git is missing). */
export async function listWorktrees(dir: string): Promise<Worktree[]> {
  try {
    return parseWorktrees(await git(dir, 'worktree', 'list', '--porcelain'));
  } catch {
    return [];
  }
}

export interface Facts {
  active: boolean;
  prunable: boolean;
  locked: boolean;
  dirty: boolean;
  merged: boolean;
  gone: boolean;
  unpushed: boolean;
  detached: boolean;
}

/** One state per worktree; the first that applies wins, so a state that blocks closing beats one that invites it. */
export function classify(f: Facts): WorktreeState {
  if (f.active) return 'active';
  if (f.prunable) return 'folder-gone';
  if (f.locked) return 'locked';
  if (f.dirty) return 'dirty';
  if (f.merged) return 'merged';
  if (f.gone) return 'remote-gone';
  if (f.unpushed) return 'not-pushed';
  if (f.detached) return 'detached';
  return 'open';
}

/**
 * Every worktree of the repo at `dir` except the main checkout, with its state.
 * `fetch` runs `git fetch --prune` first so squash-merged branches show as remote gone.
 * `activeCwds` are the folders shub sessions run in. Empty when `dir` is no git repository.
 */
export async function worktreeOverview(
  projectId: string,
  dir: string,
  activeCwds: string[],
  fetch = false,
): Promise<WorktreeInfo[]> {
  let entries: Entry[];
  try {
    entries = parseEntries(await git(dir, 'worktree', 'list', '--porcelain'));
  } catch {
    return [];
  }
  const [main, ...rest] = entries.filter((e) => !e.bare);
  const others = rest.filter((e) => e.path !== dir);
  if (!main || !others.length) return [];
  if (fetch) await git(dir, 'fetch', '--prune', '--quiet').catch(() => {});
  const bases = (
    await git(
      dir,
      'for-each-ref',
      '--format=%(refname)',
      'refs/remotes/origin/develop',
      'refs/remotes/origin/main',
      'refs/remotes/origin/master',
    )
  )
    .split('\n')
    .filter(Boolean);
  const gone = new Set(
    (await git(dir, 'for-each-ref', '--format=%(refname:short)\t%(upstream:track)', 'refs/heads'))
      .split('\n')
      .filter((l) => l.endsWith('\t[gone]'))
      .map((l) => l.split('\t')[0]),
  );
  const within = (cwd: string, path: string) => cwd === path || cwd.startsWith(`${path}/`);
  return Promise.all(
    others.map(async (e) => {
      const ok = async (...args: string[]) =>
        git(dir, ...args).then(
          () => true,
          () => false,
        );
      const live = !e.prunable;
      const [dirty, unpushed, lastCommitAt, mergedInto] = await Promise.all([
        live
          ? git(e.path, 'status', '--porcelain').then(
              (s) => s !== '',
              () => false,
            )
          : false,
        live
          ? git(e.path, 'rev-list', '--count', 'HEAD', '--not', '--remotes').then(
              (n) => n !== '0',
              () => false,
            )
          : false,
        git(dir, 'log', '-1', '--format=%cI', e.head).catch(() => ''),
        Promise.all(bases.map((b) => ok('merge-base', '--is-ancestor', e.head, b))),
      ]);
      const state = classify({
        active: activeCwds.some((c) => within(c, e.path)),
        prunable: e.prunable,
        locked: e.locked,
        dirty,
        merged: e.head !== '' && mergedInto.some(Boolean),
        gone: gone.has(e.branch),
        unpushed,
        detached: !e.branch,
      });
      return {
        projectId,
        path: e.path,
        name: basename(e.path),
        branch: e.branch,
        state,
        lastCommitAt: lastCommitAt || null,
      };
    }),
  );
}

/** States "Close" refuses: closing would lose work, git would refuse anyway, or the folder is already gone (prune). */
export const KEEP: WorktreeState[] = ['active', 'folder-gone', 'locked', 'dirty', 'not-pushed'];

/**
 * Plain git close: `git worktree remove` (never --force) and, only when merged, the branch.
 * Returns whether the branch was deleted.
 */
export async function removeWorktree(dir: string, w: WorktreeInfo): Promise<boolean> {
  if (KEEP.includes(w.state)) throw new Error(`${w.name} is ${w.state.replace('-', ' ')}; not closed`);
  await git(dir, 'worktree', 'remove', w.path);
  if (w.state !== 'merged' || !w.branch) return false;
  await git(dir, 'branch', '-D', w.branch);
  return true;
}

/** Forgets worktrees whose folder is gone. */
export async function pruneWorktrees(dir: string): Promise<void> {
  await git(dir, 'worktree', 'prune');
}
