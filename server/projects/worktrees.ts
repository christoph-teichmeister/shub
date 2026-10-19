// Git worktrees of a project folder, for buttons that ask "pick-worktree".
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Worktree } from '../../shared/api.ts';

const run = promisify(execFile);

/** Parses `git worktree list --porcelain`; bare and prunable (folder gone) entries are left out. */
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    const lines = block.split('\n');
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    if (!path || lines.some((l) => l === 'bare' || l.startsWith('prunable'))) continue;
    const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length) ?? '';
    out.push({ path, branch: ref.replace(/^refs\/heads\//, '') });
  }
  return out;
}

/** Empty when the folder is no git repository (or git is missing). */
export async function listWorktrees(dir: string): Promise<Worktree[]> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'worktree', 'list', '--porcelain'], { timeout: 5000 });
    return parseWorktrees(stdout);
  } catch {
    return [];
  }
}
