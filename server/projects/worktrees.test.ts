import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorktrees, parseWorktrees } from './worktrees.ts';

test('parseWorktrees: branches shortened, detached is "", bare and prunable skipped', () => {
  const porcelain = [
    'worktree /p/app\nHEAD 1111\nbranch refs/heads/main',
    'worktree /p/app/.claude/worktrees/x\nHEAD 2222\ndetached',
    'worktree /p/bare\nbare',
    'worktree /p/gone\nHEAD 3333\nbranch refs/heads/old\nprunable gitdir file points to non-existent location',
    '',
  ].join('\n\n');
  assert.deepEqual(parseWorktrees(porcelain), [
    { path: '/p/app', branch: 'main' },
    { path: '/p/app/.claude/worktrees/x', branch: '' },
  ]);
});

test('listWorktrees runs git in the folder; not a repo gives []', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shub-wt-')));
  const repo = join(root, 'repo');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('worktree', 'add', '-q', '-b', 'feat-x', join(root, 'wt'));
  assert.deepEqual(await listWorktrees(repo), [
    { path: repo, branch: 'main' },
    { path: join(root, 'wt'), branch: 'feat-x' },
  ]);
  assert.deepEqual(await listWorktrees(root), []);
  rmSync(root, { recursive: true, force: true });
});
