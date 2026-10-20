import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorktrees, parseWorktrees, pruneWorktrees, removeWorktree, worktreeOverview } from './worktrees.ts';

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

test('worktreeOverview: one state per worktree; removeWorktree keeps work, prune forgets gone folders', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shub-wt-')));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  const at = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  const git = (...args: string[]) => at(repo, ...args);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', remote]);
  execFileSync('git', ['clone', '-q', remote, repo], { stdio: 'pipe' });
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('push', '-q', 'origin', 'HEAD:develop');
  const add = (name: string) => git('worktree', 'add', '-q', '-b', name, join(root, name), 'origin/develop');
  for (const name of ['merged', 'fresh', 'dirty', 'local', 'squashed', 'busy', 'gone', 'pushed']) add(name);
  at(join(root, 'merged'), 'commit', '-q', '--allow-empty', '-m', 'merged');
  at(join(root, 'merged'), 'push', '-q', 'origin', 'HEAD:develop');
  writeFileSync(join(root, 'dirty', 'x'), 'x');
  at(join(root, 'local'), 'commit', '-q', '--allow-empty', '-m', 'local');
  for (const name of ['squashed', 'pushed']) {
    at(join(root, name), 'commit', '-q', '--allow-empty', '-m', name);
    at(join(root, name), 'push', '-q', '-u', 'origin', name);
  }
  execFileSync('git', ['-C', remote, 'branch', '-D', 'squashed']);
  rmSync(join(root, 'gone'), { recursive: true });

  const states = async (fetch = false) =>
    Object.fromEntries(
      (await worktreeOverview('p', repo, [join(root, 'busy', 'sub')], fetch)).map((w) => [w.name, w.state]),
    );
  assert.deepEqual(await states(true), {
    merged: 'merged',
    fresh: 'open', // no commit of its own: not merged, so "Close all merged" leaves it
    dirty: 'dirty',
    local: 'not-pushed',
    squashed: 'remote-gone',
    busy: 'active',
    gone: 'folder-gone',
    pushed: 'open',
  });

  const list = await worktreeOverview('p', repo, [], false);
  const pick = (name: string) => list.find((w) => w.name === name)!;
  await assert.rejects(removeWorktree(repo, pick('local')), /not pushed/);
  await assert.rejects(removeWorktree(repo, pick('dirty')), /dirty/);
  assert.equal(await removeWorktree(repo, pick('merged')), true);
  assert.equal(await removeWorktree(repo, pick('squashed')), false); // branch kept: git can't tell it landed
  assert.equal(existsSync(join(root, 'merged')), false);
  assert.match(git('branch', '--list', 'squashed').toString(), /squashed/);
  assert.equal(git('branch', '--list', 'merged').toString(), '');
  await pruneWorktrees(repo);
  assert.deepEqual(Object.keys(await states()).sort(), ['busy', 'dirty', 'fresh', 'local', 'pushed']);
  rmSync(root, { recursive: true, force: true });
});
