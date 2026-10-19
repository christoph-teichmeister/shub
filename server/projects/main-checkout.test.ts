import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { guard, updateMainCheckout } from './main-checkout.ts';

const MAIN = '/repo';
const TREES = ['/repo', '/repo/.claude/worktrees/x', '/elsewhere/y'];
const bash = (command: string, cwd = MAIN) =>
  guard(MAIN, TREES, 'develop', { cwd, tool_name: 'Bash', tool_input: { command } });
const edit = (file_path: string, cwd = MAIN) =>
  guard(MAIN, TREES, 'develop', { cwd, tool_name: 'Edit', tool_input: { file_path } });

test('guard blocks changing git commands in the main checkout only', () => {
  assert.match(bash('git checkout -b fix/x') ?? '', /main checkout and stays on develop/);
  assert.ok(bash('cd /repo; git switch main'));
  assert.ok(bash('git -C /repo commit -m x', '/tmp'));
  assert.ok(bash('git status && git branch -m fix/a bugfix/a'));
  assert.ok(bash('cd .. && cd repo && git stash'));
  assert.equal(bash('git status && git fetch && git log -1 && git branch'), null);
  assert.equal(bash('git worktree add .claude/worktrees/z -b feature/z origin/develop'), null);
  assert.equal(bash('cd .claude/worktrees/x && git commit -m x'), null);
  assert.equal(bash('git -C /elsewhere/y rebase origin/develop'), null);
  assert.equal(bash('git checkout main', '/other'), null);
});

test('guard blocks file edits in the main checkout but not in its worktrees', () => {
  assert.ok(edit('/repo/web/a.ts'));
  assert.ok(edit('web/a.ts'));
  assert.equal(edit('/repo/.claude/worktrees/x/web/a.ts'), null);
  assert.equal(edit('web/a.ts', '/repo/.claude/worktrees/x'), null);
  assert.equal(edit('/tmp/a.ts'), null);
  assert.equal(
    guard(MAIN, TREES, 'develop', { cwd: MAIN, tool_name: 'Read', tool_input: { file_path: '/repo/a' } }),
    null,
  );
});

test('update fast-forwards only a clean checkout on its branch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shub-main-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const origin = join(dir, 'origin');
  const main = join(dir, 'main');
  git(dir, 'init', '-q', '-b', 'develop', origin);
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'one');
  git(dir, 'clone', '-q', origin, main);
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'two');

  writeFileSync(join(main, 'f'), 'x');
  git(main, 'add', 'f');
  assert.equal(await updateMainCheckout(main, 'develop'), 'fetched; local changes, not fast-forwarded');
  git(main, 'reset', '-q', '--hard');
  assert.equal(await updateMainCheckout(main, 'main'), 'fetched; on develop instead of main, not fast-forwarded');
  assert.equal(await updateMainCheckout(main, 'develop'), 'fetched and fast-forwarded');
  assert.equal(git(main, 'log', '-1', '--format=%s'), 'two');
});
