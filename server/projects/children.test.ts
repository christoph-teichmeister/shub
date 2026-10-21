import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openState } from '../state/index.ts';
import { encodeCwd } from '../sessions/old.ts';
import {
  CHILD_MIGRATIONS,
  childCandidates,
  childRows,
  newestTranscript,
  recordChildren,
  worktreeAddPaths,
} from './children.ts';
import { worktreeOverview } from './worktrees.ts';

test('git worktree add in a Bash command: path resolved against cwd, cd and -C, options skipped', () => {
  assert.deepEqual(worktreeAddPaths('git worktree add .claude/worktrees/x -b feat/x origin/develop', '/r'), [
    '/r/.claude/worktrees/x',
  ]);
  assert.deepEqual(worktreeAddPaths('git fetch && git worktree add -b feat/y -f "../with space" HEAD', '/r/sub'), [
    '/r/with space',
  ]);
  assert.deepEqual(worktreeAddPaths('cd /a && git -C b worktree add --detach wt origin/mr', '/r'), ['/a/b/wt']);
  assert.deepEqual(worktreeAddPaths('git worktree list; git status', '/r'), []);
});

test('the three tool shapes that create a worktree, as PostToolUse payloads carry them', () => {
  const bash = {
    tool_name: 'Bash',
    cwd: '/r',
    tool_input: { command: 'git worktree add .claude/worktrees/rev --detach origin/feature' },
    tool_response: { stdout: '', stderr: 'Preparing worktree (detached HEAD 1a2b3c4)\n' },
  };
  // Claude Code 2.1.306: EnterWorktree answers with the path it created or entered.
  const enter = {
    tool_name: 'EnterWorktree',
    cwd: '/r/.claude/worktrees/probe',
    tool_input: { name: 'probe' },
    tool_response: { worktreePath: '/r/.claude/worktrees/probe', worktreeBranch: 'worktree-probe', message: '…' },
  };
  // A foreground Agent names its worktree only when Claude kept it (it had changes) ...
  const agent = {
    tool_name: 'Agent',
    cwd: '/r',
    tool_input: { prompt: 'x', isolation: 'worktree' },
    tool_response: { status: 'completed', agentId: 'ad74', worktreePath: '/r/.claude/worktrees/agent-ad74' },
  };
  // ... a background one only says which agent it is.
  const background = {
    tool_name: 'Agent',
    cwd: '/r',
    tool_input: { prompt: 'x', isolation: 'worktree', run_in_background: true },
    tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1d6' },
  };
  assert.deepEqual(childCandidates(bash), [{ path: '/r/.claude/worktrees/rev' }]);
  assert.deepEqual(childCandidates(enter), [{ path: '/r/.claude/worktrees/probe' }]);
  assert.deepEqual(childCandidates(agent), [{ path: '/r/.claude/worktrees/agent-ad74' }]);
  assert.deepEqual(childCandidates(background), [{ agentId: 'a1d6' }]);
  assert.deepEqual(childCandidates({ ...agent, tool_input: { prompt: 'x' } }), []);
  assert.deepEqual(childCandidates({ tool_name: 'Read', tool_input: { file_path: '/x' } }), []);
});

/** A repo with origin/develop, cloned to `repo`. */
function repoWithRemote() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shub-children-')));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  const at = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' })
      .toString()
      .trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', remote]);
  execFileSync('git', ['clone', '-q', remote, repo], { stdio: 'pipe' });
  at(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  at(repo, 'push', '-q', 'origin', 'HEAD:develop');
  return { root, repo, at };
}

test('recordChildren keeps worktrees git knows, once each, under the repo project', async () => {
  const { root, repo, at } = repoWithRemote();
  const state = openState(join(root, 'state'));
  state.migrate('worktrees', CHILD_MIGRATIONS);
  const projects = [{ id: 'p', path: repo }];
  at(repo, 'worktree', 'add', '-q', '-b', 'feat', '.claude/worktrees/feat', 'origin/develop');
  at(repo, 'worktree', 'add', '-q', '-b', 'worktree-agent-a1d6', '.claude/worktrees/agent-a1d6');
  const bash = (command: string) => ({ tool_name: 'Bash', cwd: repo, tool_input: { command } });

  assert.deepEqual(await recordChildren(state, 's1', projects, bash('git worktree add .claude/worktrees/feat')), [
    join(repo, '.claude/worktrees/feat'),
  ]);
  // The command failed or named something else: git does not list it, nothing is stored.
  assert.deepEqual(await recordChildren(state, 's1', projects, bash('git worktree add .claude/worktrees/nope')), []);
  const background = {
    tool_name: 'Agent',
    cwd: repo,
    tool_input: { isolation: 'worktree' },
    tool_response: { agentId: 'a1d6' },
  };
  assert.deepEqual(await recordChildren(state, 's2', projects, background), [
    join(repo, '.claude/worktrees/agent-a1d6'),
  ]);
  // First sight wins: entering it later from another session changes nothing.
  const enter = {
    tool_name: 'EnterWorktree',
    cwd: repo,
    tool_response: { worktreePath: join(repo, '.claude/worktrees/feat') },
  };
  assert.deepEqual(await recordChildren(state, 's3', projects, enter), []);
  assert.deepEqual(
    childRows(state).map((r) => [r.origin_session_id, r.project_id, r.in_default_at_creation]),
    [
      ['s1', 'p', 1],
      ['s2', 'p', 1],
    ],
  );
  state.db.close();
  rmSync(root, { recursive: true, force: true });
});

test('merged: a tracked detached review checkout counts once its head lands; a fresh develop checkout never', async () => {
  const { root, repo, at } = repoWithRemote();
  const state = openState(join(root, 'state'));
  state.migrate('worktrees', CHILD_MIGRATIONS);
  // An MR branch on the remote, reviewed in detached checkouts.
  at(repo, 'switch', '-q', '-c', 'mr');
  at(repo, 'commit', '-q', '--allow-empty', '-m', 'mr work');
  at(repo, 'push', '-q', 'origin', 'mr');
  at(repo, 'switch', '-q', 'develop');
  for (const name of ['review', 'untracked'])
    at(repo, 'worktree', 'add', '-q', '--detach', `.claude/worktrees/${name}`, 'origin/mr');
  at(repo, 'worktree', 'add', '-q', '-b', 'cut', '.claude/worktrees/cut', 'origin/develop');
  const projects = [{ id: 'p', path: repo }];
  for (const name of ['review', 'cut']) {
    const command = `git worktree add .claude/worktrees/${name}`;
    await recordChildren(state, 's1', projects, { tool_name: 'Bash', cwd: repo, tool_input: { command } });
  }
  const states = async () => {
    const tracked = new Map(childRows(state).map((r) => [r.worktree_path, r]));
    const list = await worktreeOverview('p', repo, [], { fetch: true, tracked });
    return Object.fromEntries(list.map((w) => [w.name, w.state]));
  };
  assert.deepEqual(await states(), { review: 'detached', untracked: 'detached', cut: 'open' });

  at(repo, 'push', '-q', 'origin', 'origin/mr:refs/heads/develop'); // the MR lands (fast-forward)
  assert.deepEqual(await states(), {
    review: 'merged',
    untracked: 'detached', // the reflog rule: one entry, so an untracked review checkout never counts as merged
    cut: 'open', // HEAD is the develop commit it was cut from: nothing of its own landed
  });
  state.db.close();
  rmSync(root, { recursive: true, force: true });
});

test('newestTranscript: newest conversation of the folder, skipping held ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-transcripts-'));
  const dir = join(root, 'projects', encodeCwd('/r/.claude/worktrees/rev'));
  mkdirSync(join(dir, 'old-id', 'subagents'), { recursive: true });
  for (const [id, at] of [
    ['old-id', 1_000],
    ['new-id', 2_000],
    ['held-id', 3_000],
  ] as const) {
    writeFileSync(join(dir, `${id}.jsonl`), '{}\n');
    utimesSync(join(dir, `${id}.jsonl`), at, at);
  }
  assert.equal(newestTranscript('/r/.claude/worktrees/rev', new Set(['held-id']), root)?.claudeSessionId, 'new-id');
  assert.equal(newestTranscript('/r/.claude/worktrees/none', new Set(), root), null);
  rmSync(root, { recursive: true, force: true });
});
