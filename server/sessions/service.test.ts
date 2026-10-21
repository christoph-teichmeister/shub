// Runs real tmux on a test-only socket (shub-test-<pid>) with bash instead of claude; kills only that server.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { Config, Project, ServerEvent } from '../../shared/api.ts';
import { installUpgrades } from '../api/upgrade.ts';
import { EventBus, type Context } from '../context.ts';
import type { Services } from '../services.ts';
import { CHILD_MIGRATIONS, childRows, recordChildren } from '../projects/children.ts';
import { openState } from '../state/index.ts';
import type { LaunchSpec } from './launch.ts';
import { encodeCwd } from './old.ts';
import { SessionsService, tmuxName } from './service.ts';
import { attachTerminals } from './terminal.ts';
import type { CheckResult } from './waitcheck.ts';

const root = mkdtempSync(join(tmpdir(), 'shub-sessions-'));
const projectDir = join(root, 'proj');
mkdirSync(projectDir);
const project: Project = {
  id: 'p1',
  name: 'One',
  path: projectDir,
  group: 'g',
  visibility: 'pinned',
  order: 0,
  icon: { kind: 'auto' },
  buttons: [
    { id: 'rev', label: 'Review', skill: '/review', ask: 'text', confirm: false, permissionMode: 'acceptEdits' },
  ],
};
const ctx: Context = {
  paths: { configDir: join(root, 'config'), stateDir: join(root, 'state'), appDir: process.cwd() },
  host: '127.0.0.1',
  port: 1,
  tmuxSocket: `shub-test-${process.pid}`,
  bus: new EventBus(),
};
const events: ServerEvent[] = [];
ctx.bus.on((e) => events.push(e));
const issued: string[] = [];
const revoked: string[] = [];
const launches: LaunchSpec[] = [];
const state = openState(ctx.paths.stateDir);
let defaultPermissionMode: Config['defaultPermissionMode'] = 'default';
const services = {
  state,
  config: {
    get: () => ({ projects: [project], defaultPermissionMode }) as unknown as Config,
    project: (id: string) => (id === 'p1' ? project : undefined),
  },
  auth: {
    issueClientToken: () => (issued.push(`tok-${issued.length + 1}`), issued.at(-1)!),
    revokeClientToken: (t: string) => revoked.push(t),
  },
  permissions: { log: () => ({}) },
  notify: {
    needsYou: (s: { id: string }, text: string) => notified.push(`${s.id}: ${text}`),
    yourTurn: (s: { id: string }) => notified.push(`${s.id}: your turn`),
  },
} as unknown as Services;
const notified: string[] = [];
let checkAnswer: CheckResult | null = null;
const checks: string[] = [];
const svc = new SessionsService(ctx, services, {
  restoreGapMs: 300,
  startedGapMs: 50,
  launcher: (spec) => (launches.push(spec), ['bash', '--norc', '--noprofile']),
  titler: async (prompt) => (prompt === 'do the thing' ? 'Thing Doing' : null),
  mrLookup: async (ref) =>
    ref.number === 5 ? { title: 'Fix login', mine: false } : { title: '#12: Own work', mine: true },
  waitChecker: async (check) => (checks.push(check), checkAnswer),
});

async function waitFor(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const pane = (id: string): string => svc.tmux.run(['capture-pane', '-p', '-t', `=${tmuxName(id)}:`]);

before(() => svc.init());
after(() => {
  svc.stop();
  svc.tmux.killServer();
  // kill-server leaves the socket file behind.
  const uid = process.getuid?.() ?? 0;
  rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${uid}`, ctx.tmuxSocket), { force: true });
  state.db.close();
  rmSync(root, { recursive: true, force: true });
});

test('button start: id, name, mode, prompt, env token', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1', buttonId: 'rev', input: '#7' }, 'chris');
  assert.equal(s.id, 'p1-1');
  assert.equal(s.name, 'Review #7');
  assert.equal(s.permissionMode, 'acceptEdits');
  assert.equal(s.status, 'working');
  assert.equal(launches.at(-1)?.prompt, '/review #7');
  assert.ok(existsSync(join(ctx.paths.stateDir, 'sessions', 'p1-1', 'settings.json')));
  svc.sendKeys('p1-1', ['echo T=$SHUB_TOKEN:$SHUB_SESSION_ID', 'Enter']);
  await waitFor(() => pane('p1-1').includes('T=tok-1:p1-1'), 'token in env');
});

test('paste text and files', async () => {
  svc.pasteText('p1-1', 'hello paste');
  await waitFor(() => pane('p1-1').includes('hello paste'), 'pasted text');
  const file = svc.pasteFile('p1-1', 'image/png', Buffer.from('png'));
  assert.ok(file.startsWith(join(ctx.paths.stateDir, 'pastes')) && file.endsWith('.png') && existsSync(file));
  await waitFor(() => pane('p1-1').replace(/\n/g, '').includes(file), 'pasted path');
  assert.ok(svc.pasteFile('p1-1', 'video/mp4', Buffer.from('mp4'), 'clip.MP4').endsWith('.mp4'));
  assert.ok(svc.pasteFile('p1-1', '', Buffer.from('x'), 'a.sh;rm -rf').endsWith('.bin'));
  assert.throws(() => svc.sendKeys('p1-1', ['x'.repeat(2001)]), /keys must be/);
  svc.sendKeys('p1-1', ['C-c']);
  await waitFor(() => pane('p1-1').trimEnd().endsWith('$'), 'fresh prompt after C-c');
});

test('terminal websocket pipes bytes both ways', async () => {
  const server: Server = createServer();
  installUpgrades(
    server,
    () => null,
    () => ({ kind: 'user', id: 'chris', rights: [] }),
  );
  attachTerminals(server, svc);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(
    `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/terminals/p1-1?cols=100&rows=30`,
  );
  let seen = '';
  ws.on('message', (d) => (seen += d.toString()));
  await new Promise((r) => ws.on('open', r));
  ws.send('\u0000' + JSON.stringify({ type: 'resize', cols: 90, rows: 25 }));
  // tmux flushes input typed before its client is up, so wait for the first screen.
  await waitFor(() => seen.includes('\u001b['), 'tmux screen');
  ws.send('echo ws$((40+2))\r');
  await waitFor(() => seen.includes('ws42'), 'output over websocket');
  ws.close();
  server.close();
});

test('shells belong to their parent and close with it', async () => {
  const sh = await svc.start({ kind: 'shell', projectId: null, parentId: 'p1-1' }, 'chris');
  assert.equal(sh.id, 'p1-sh1');
  assert.equal(sh.cwd, projectDir);
  assert.equal(sh.status, 'your-turn');
  svc.close('p1-1', 'chris');
  assert.equal(svc.get('p1-1')?.status, 'exited');
  assert.equal(svc.get('p1-sh1')?.status, 'exited');
  assert.ok(!svc.tmux.has(tmuxName('p1-sh1')));
  assert.deepEqual(revoked, ['tok-1']);
  assert.equal(events.filter((e) => e.type === 'session.closed').length, 2);
});

test('pause and resume', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1', prompt: 'do the thing' }, 'session:x');
  assert.equal(s.id, 'p1-2');
  assert.equal(s.permissionMode, 'default');
  assert.equal(s.name, 'do the thing', 'first words until the title arrives');
  await new Promise((r) => setImmediate(r));
  assert.equal(svc.get(s.id)?.name, 'Thing Doing');
  svc.pause(s.id, 'chris');
  assert.equal(svc.get(s.id)?.status, 'paused');
  assert.ok(!svc.tmux.has(tmuxName(s.id)));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-resume');
  try {
    svc.resume(s.id, 'chris');
    assert.equal(launches.at(-1)?.resume, false, 'no transcript yet: starts fresh with the same id');
    assert.equal(launches.at(-1)?.claudeSessionId, s.claudeSessionId);
    const dir = join(root, 'claude-resume', 'projects', encodeCwd(s.cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${s.claudeSessionId}.jsonl`), '{}');
    svc.pause(s.id, 'chris');
    svc.resume(s.id, 'chris');
    assert.equal(launches.at(-1)?.resume, true);
    assert.ok(svc.tmux.has(tmuxName(s.id)));

    // Claude moved into a worktree: the transcript lives under the worktree's folder, so it resumes there.
    rmSync(join(dir, `${s.claudeSessionId}.jsonl`));
    const worktree = join(s.cwd, '.claude', 'worktrees', 'w1');
    mkdirSync(worktree, { recursive: true });
    const wtDir = join(root, 'claude-resume', 'projects', encodeCwd(worktree));
    mkdirSync(wtDir, { recursive: true });
    const lines = [s.cwd, worktree, join(worktree, 'sub')].map((cwd) => JSON.stringify({ cwd }));
    writeFileSync(join(wtDir, `${s.claudeSessionId}.jsonl`), lines.join('\n'));
    svc.pause(s.id, 'chris');
    svc.resume(s.id, 'chris');
    assert.equal(launches.at(-1)?.resume, true);
    assert.equal(svc.get(s.id)?.cwd, worktree);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

test('a session whose process exits is marked exited', async () => {
  svc.sendKeys('p1-2', ['exit', 'Enter']);
  await waitFor(() => !svc.tmux.has(tmuxName('p1-2')), 'tmux session gone');
  svc.reconcile();
  assert.equal(svc.get('p1-2')?.status, 'exited');
});

test('after a reboot: restorable list, global Claude comes up, restore resumes', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  assert.equal(s.status, 'new', 'no prompt yet');
  svc.tmux.killServer(); // the test socket's server only
  svc.startup();
  await waitFor(() => svc.get('global')?.status === 'new', 'global Claude');
  assert.equal(svc.get('global')?.cwd, process.env.HOME);
  assert.deepEqual(
    svc.restorable().map((r) => r.id),
    [s.id],
  );
  const second = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.tmux.kill(tmuxName(second.id));
  svc.tmux.kill(tmuxName(s.id));
  svc.startup();
  const queued = svc.restore([s.id, second.id], 'chris');
  assert.deepEqual(
    queued.map((q) => q.status),
    ['starting', 'starting'],
  );
  assert.ok(svc.tmux.has(tmuxName(s.id)), 'first one resumes at once');
  assert.ok(!svc.tmux.has(tmuxName(second.id)), 'the next waits its turn');
  assert.equal(svc.get(second.id)?.status, 'starting');
  await waitFor(() => svc.tmux.has(tmuxName(second.id)), 'second resumes after the gap');
  assert.equal(svc.get(second.id)?.status, 'new');
  assert.deepEqual(svc.restorable(), []);
  const again = await svc.start({ kind: 'global', projectId: null }, 'chris');
  assert.equal(again.id, 'global', 'exactly one global Claude');
  await svc.start({ kind: 'global', projectId: null, prompt: 'echo timesheet-handover' }, 'chris');
  await waitFor(() => pane('global').includes('timesheet-handover'), 'prompt typed into the global Claude');
});

test('start can reopen an old conversation with --resume; /clear moves the id', async () => {
  const claudeId = '0b0e4c2a-6a39-4d55-9f7e-0c6a1d2c3b4a';
  const dir = join(root, 'claude', 'projects', encodeCwd(projectDir));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${claudeId}.jsonl`), JSON.stringify({ type: 'user', message: { content: 'fix login' } }));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
  try {
    const req = { kind: 'claude' as const, projectId: 'p1', resumeClaudeSessionId: claudeId };
    const s = await svc.start(req, 'chris');
    assert.equal(s.claudeSessionId, claudeId);
    assert.equal(s.name, 'fix login');
    assert.equal(s.status, 'your-turn');
    assert.equal(launches.at(-1)?.resume, true);
    await assert.rejects(svc.start(req, 'chris'), /already open/);
    await assert.rejects(svc.start({ ...req, resumeClaudeSessionId: '../../x' }, 'chris'), /UUID/);
    await assert.rejects(
      svc.start({ ...req, resumeClaudeSessionId: '1b0e4c2a-6a39-4d55-9f7e-0c6a1d2c3b4a' }, 'chris'),
      /no such conversation/,
    );
    const fresh = '2b0e4c2a-6a39-4d55-9f7e-0c6a1d2c3b4a';
    svc.setClaudeSessionId(s.id, fresh);
    assert.equal(svc.get(s.id)?.claudeSessionId, fresh);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

test('the default permission mode setting reaches user starts only; hooks update the mode', async () => {
  defaultPermissionMode = 'inherit';
  try {
    const mine = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris', true);
    assert.equal(mine.permissionMode, 'inherit');
    assert.equal(launches.at(-1)?.permissionMode, 'inherit');
    const theirs = await svc.start({ kind: 'claude', projectId: 'p1' }, 'plugin:x');
    assert.equal(theirs.permissionMode, 'default');
    const button = await svc.start({ kind: 'claude', projectId: 'p1', buttonId: 'rev', input: 'x' }, 'chris', true);
    assert.equal(button.permissionMode, 'acceptEdits');

    svc.setPermissionMode(mine.id, 'auto');
    assert.equal(svc.get(mine.id)?.permissionMode, 'auto');
    for (const s of [mine, theirs, button]) svc.close(s.id, 'chris');
  } finally {
    defaultPermissionMode = 'default';
  }
});

test('wait parks a session, ending the wait hands it back', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(s.id, 'your-turn');
  const parked = svc.wait(s.id, "  Kai's answer on the MR ", 'chris');
  assert.equal(parked.status, 'waiting');
  assert.equal(parked.waitingFor, "Kai's answer on the MR");
  svc.setStatus(s.id, 'working');
  svc.wait(s.id, 'still Kai', 'chris');
  assert.equal(svc.get(s.id)?.status, 'working', 'mid-turn the Stop hook parks it');
  svc.setStatus(s.id, 'needs-you', { tool: 'Bash', summary: 'ls' });
  svc.wait(s.id, 'still Kai', 'chris');
  assert.equal(svc.get(s.id)?.status, 'needs-you', 'an open permission question stays');
  svc.setStatus(s.id, 'needs-you', null);
  svc.wait(s.id, 'still Kai', 'chris');
  assert.equal(svc.get(s.id)?.status, 'waiting', 'the idle reminder gives way');
  const back = svc.wait(s.id, null, `session:${s.id}`);
  assert.equal(back.status, 'your-turn');
  assert.equal(back.waitingFor, null);
  assert.throws(() => svc.wait(s.id, ' ', 'chris'), /must not be empty/);
});

test('a turn paused on background work falls back to your-turn after its fallback', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(s.id, 'working', null, undefined, 90_000);
  const row = state.db.prepare('SELECT background_until FROM sessions WHERE id = ?').get(s.id);
  assert.ok(Number(row?.background_until) > Date.now(), 'the fallback is in the db, so a restart keeps it');
  svc.reconcile(Date.now() + 60_000);
  assert.equal(svc.get(s.id)?.status, 'working');
  svc.reconcile(Date.now() + 2 * 60_000);
  assert.equal(svc.get(s.id)?.status, 'your-turn');
  assert.deepEqual(notified.splice(0), [`${s.id}: your turn`]);
  svc.setStatus(s.id, 'working', null, undefined, 90_000);
  svc.setStatus(s.id, 'working');
  svc.reconcile(Date.now() + 2 * 60_000);
  assert.equal(svc.get(s.id)?.status, 'working', 'a new hook clears the fallback');
  svc.keepBackground(s.id, 10 * 60_000);
  svc.reconcile(Date.now() + 2 * 60_000);
  assert.equal(svc.get(s.id)?.status, 'working', 'no fallback pending: nothing to push');
  svc.setStatus(s.id, 'working', null, undefined, 90_000);
  svc.keepBackground(s.id, 10 * 60_000);
  svc.reconcile(Date.now() + 5 * 60_000);
  assert.equal(svc.get(s.id)?.status, 'working', 'a busy agent pushes the fallback');
  svc.reconcile(Date.now() + 11 * 60_000);
  assert.equal(svc.get(s.id)?.status, 'your-turn');
  notified.splice(0);
});

test('a finished turn remembers its running shells until the next status', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(s.id, 'your-turn', null, null, 0, 2);
  assert.equal(svc.get(s.id)?.shells, 2);
  svc.setStatus(s.id, 'working', null, null);
  assert.equal(svc.get(s.id)?.shells, 0);
});

test('statusSince moves only when the status changes', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  assert.equal(s.statusSince, s.createdAt);
  await tick();
  svc.setStatus(s.id, 'working');
  const since = svc.get(s.id)!.statusSince;
  assert.ok(since > s.statusSince);
  await tick();
  svc.setStatus(s.id, 'working');
  assert.equal(svc.get(s.id)?.statusSince, since);
  assert.ok(svc.get(s.id)!.lastActivityAt > since);
  await tick();
  svc.setStatus(s.id, 'your-turn');
  assert.ok(svc.get(s.id)!.statusSince > since);
});

test('a wait check runs at once, keeps waiting on NOT YET and hands back on DONE', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(s.id, 'your-turn');
  const parked = svc.wait(s.id, 'Kai', 'chris', { prompt: 'Has Kai replied in MR !2213?', everyMinutes: 1 });
  assert.equal(parked.waitCheck?.everyMinutes, 5, 'at least 5 minutes apart');
  checkAnswer = { done: false, summary: 'no new comment' };
  await svc.checkWait(s.id);
  assert.deepEqual(checks, ['Has Kai replied in MR !2213?']);
  assert.equal(svc.get(s.id)?.status, 'waiting');
  assert.equal(svc.get(s.id)?.waitCheck?.last, 'NOT YET: no new comment');
  await svc.checkWait(s.id);
  assert.equal(checks.length, 1, 'not due again yet');
  checkAnswer = { done: true, summary: 'Kai approved the MR' };
  await svc.checkWait(s.id, true);
  assert.equal(svc.get(s.id)?.status, 'your-turn');
  assert.equal(svc.get(s.id)?.waitCheck, null);
  assert.deepEqual(notified.splice(0), [`${s.id}: Kai approved the MR`]);
});

test('a wait check with a follow-up types it into the session instead of notifying', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(s.id, 'your-turn');
  svc.wait(s.id, 'Kai', 'chris', { prompt: 'Kai?', onDone: '  echo wait-over-{summary}  ' });
  assert.equal(svc.get(s.id)?.waitCheck?.onDone, 'echo wait-over-{summary}');
  checkAnswer = { done: true, summary: 'approved' };
  await svc.checkWait(s.id, true);
  await waitFor(() => pane(s.id).includes('echo wait-over-approved'), 'follow-up typed into the session');
  assert.deepEqual(notified.splice(0), []);
});

test('the third failed wait check in a row notifies once, an answer resets the count', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(s.id, 'your-turn');
  svc.wait(s.id, 'Kai', 'chris', { prompt: 'Kai?' });
  checkAnswer = null;
  for (let i = 0; i < 4; i++) await svc.checkWait(s.id, true);
  assert.equal(svc.get(s.id)?.waitCheck?.failures, 4);
  assert.deepEqual(notified.splice(0), [`${s.id}: Wait check failed 3 times in a row: Kai?`]);
  checkAnswer = { done: false, summary: 'not yet' };
  await svc.checkWait(s.id, true);
  assert.equal(svc.get(s.id)?.waitCheck?.failures, 0);
});

test('a handed-over command runs in the session it names, resuming it first', async () => {
  const writer = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  const target = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  svc.setStatus(writer.id, 'needs-you', null, [
    { command: 'echo routed-1', session: target.id },
    { command: 'echo nowhere', session: 'nope' },
  ]);
  assert.throws(() => svc.answerCommand(writer.id, 1, 'run'), /Open in terminal/);
  svc.answerCommand(writer.id, 0, 'run');
  await waitFor(() => pane(target.id).includes('echo routed-1'), 'command in the target');
  assert.ok(!pane(writer.id).includes('echo routed-1'), 'not in the writing session');
  assert.equal(svc.get(writer.id)?.pendingCommands, null);

  svc.pause(target.id, 'chris');
  svc.setStatus(writer.id, 'needs-you', null, [{ command: 'echo routed-2', session: target.id }]);
  svc.answerCommand(writer.id, 0, 'run');
  assert.ok(svc.tmux.has(tmuxName(target.id)), 'the closed target is resumed');
  svc.started(target.id);
  await waitFor(() => pane(target.id).includes('echo routed-2'), 'command once the target is up');
});

test('worktrees a session created stay linked to it after it closes, unlike its shells', async () => {
  const repo = join(root, 'repo');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('worktree', 'add', '-q', '--detach', 'wt');
  state.migrate('worktrees', CHILD_MIGRATIONS);
  const creator = await svc.start({ kind: 'claude', projectId: 'p1' }, 'chris');
  const payload = { tool_name: 'Bash', cwd: repo, tool_input: { command: 'git worktree add wt' } };
  await recordChildren(state, creator.id, [{ id: 'p1', path: repo }], payload);
  svc.close(creator.id, 'chris');
  assert.equal(svc.get(creator.id)?.status, 'exited');
  assert.deepEqual(
    childRows(state).map((r) => [r.worktree_path, r.origin_session_id]),
    [[join(repo, 'wt'), creator.id]],
  );
});

test('an MR/PR link pins a chip and names a session shub named, never a given name', async () => {
  const s = await svc.start({ kind: 'claude', projectId: 'p1', prompt: 'review it' }, 'chris');
  const mr = 'https://gitlab.example.com/ai/portal/-/merge_requests/5';
  svc.nameFromMr(s.id, `/mr-review ${mr}`);
  await waitFor(() => svc.get(s.id)?.name === '👀 MR !5: Fix login', 'MR name');
  assert.deepEqual(svc.get(s.id)?.links, [{ source: 'shub', url: mr, label: 'MR !5' }]);
  svc.nameFromMr(s.id, 'https://github.com/a/b/pull/6');
  await waitFor(() => svc.get(s.id)?.name === '🔨 #12: Own work', 'shub may rename its own MR name');
  svc.rename(s.id, 'mine', 'chris');
  svc.nameFromMr(s.id, 'https://github.com/a/b/pull/7');
  await new Promise((r) => setImmediate(r));
  assert.equal(svc.get(s.id)?.name, 'mine');
  assert.equal(svc.get(s.id)?.links.at(-1)?.label, 'PR #7', 'the chip still comes');
  svc.close(s.id, 'chris');
});
