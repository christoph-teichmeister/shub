// Protected main checkout: sessions may not change it (guard for the PreToolUse hook), shub keeps it up to date.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** git subcommands that move HEAD, write commits or touch the working tree. */
const CHANGING = new Set([
  'am',
  'apply',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'merge',
  'pull',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'mv',
  'stash',
  'switch',
]);
const RENAME_BRANCH = /^(-[a-zA-Z]*[mMfc][a-zA-Z]*|--move|--force|--copy)$/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export interface GuardInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string; notebook_path?: string };
}

const within = (path: string, dir: string): boolean => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
};
const unquote = (s: string): string => s.replace(/^['"]|['"]$/g, '').replace(/^~(?=\/|$)/, homedir());

/**
 * Why this tool call would change the main checkout `main`, or null when it is fine.
 * `worktrees` are the other worktrees of the repo; they may sit inside `main` (e.g. .claude/worktrees/x).
 */
export function guard(main: string, worktrees: string[], branch: string, input: GuardInput): string | null {
  const cwd = input.cwd || main;
  const inMain = (p: string) => within(p, main) && !worktrees.some((w) => w !== main && within(p, w));
  const reason =
    `${main} is the main checkout and stays on ${branch}. Create a worktree ` +
    `(git worktree add .claude/worktrees/<name> -b <branch> origin/${branch}) and work there.`;

  if (EDIT_TOOLS.has(input.tool_name ?? '')) {
    const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    return file && inMain(resolve(cwd, file)) ? reason : null;
  }
  if (input.tool_name !== 'Bash') return null;

  // ponytail: plain split, so separators inside quotes and sed -i or > redirects slip through; git is what matters.
  let dir = cwd;
  for (const segment of (input.tool_input?.command ?? '').split(/&&|\|\||;|\||\n/)) {
    const words = segment.trim().split(/\s+/);
    if (words[0] === 'cd') dir = resolve(dir, unquote(words[1] ?? homedir()));
    if (words[0] !== 'git') continue;
    let gitDir = dir;
    let i = 1;
    while (words[i]?.startsWith('-')) {
      if (words[i] === '-C') gitDir = resolve(gitDir, unquote(words[i + 1] ?? ''));
      i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
    }
    const sub = words[i] ?? '';
    const changes = CHANGING.has(sub) || (sub === 'branch' && words.slice(i + 1).some((w) => RENAME_BRANCH.test(w)));
    if (changes && inMain(gitDir)) return reason;
  }
  return null;
}

const git = async (dir: string, ...args: string[]): Promise<string> =>
  (await run('git', ['-C', dir, ...args], { timeout: 120_000 })).stdout.trim();

/** Fetch; fast-forward only when the checkout is on `branch` and has no local changes. Returns what happened. */
export async function updateMainCheckout(dir: string, branch: string): Promise<string> {
  await git(dir, 'fetch', '--prune', '--quiet');
  const head = await git(dir, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '');
  if (head !== branch) return `fetched; on ${head || 'a detached HEAD'} instead of ${branch}, not fast-forwarded`;
  if (await git(dir, 'status', '--porcelain', '--untracked-files=no'))
    return 'fetched; local changes, not fast-forwarded';
  await git(dir, 'merge', '--ff-only', '--quiet', '@{u}');
  return 'fetched and fast-forwarded';
}
