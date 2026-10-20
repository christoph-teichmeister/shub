import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handedOverCommands, newClaudeSessionId, summarizeTool, transition } from './transition.ts';

test('prompt submit means working and clears a pending question', () => {
  assert.deepEqual(transition('your-turn', 'UserPromptSubmit', { prompt: 'hi' }), {
    status: 'working',
    pendingPermission: null,
    pendingCommands: null,
  });
});

test('stop means your turn with a notification', () => {
  const t = transition('working', 'Stop', { stop_hook_active: false });
  assert.equal(t?.status, 'your-turn');
  assert.deepEqual(t?.notify, { kind: 'yourTurn' });
});

test('stop with background tasks still running keeps working, and the idle reminder is ignored', () => {
  const task = { id: 'b1', type: 'shell', status: 'running', description: 'npm test' };
  assert.deepEqual(transition('working', 'Stop', { background_tasks: [task] }), {
    status: 'working',
    pendingPermission: null,
    background: true,
  });
  assert.equal(transition('working', 'Stop', { background_tasks: [] })?.status, 'your-turn');
  const agent = { id: 'a1', type: 'subagent', status: 'running', description: 'code-review' };
  assert.deepEqual(transition('working', 'Stop', { background_tasks: [agent] }), {
    status: 'working',
    pendingPermission: null,
  });
  assert.equal(transition('working', 'Notification', { notification_type: 'idle_prompt' }), null);
});

test('a closing question hands the turn over even with background shells running', () => {
  const task = { id: 'b1', type: 'shell', status: 'running', description: '', command: './run-mh.sh a' };
  const asking = (last_assistant_message: string) =>
    transition('working', 'Stop', { background_tasks: [task, task], last_assistant_message });
  for (const message of [
    'Steps:\n1. Scan\n\nDo you have an iPhone at hand?',
    'Ready?  ',
    'Merge it **now?**',
    'Go? (yes / no)',
  ]) {
    const t = asking(message);
    assert.equal(t?.status, 'your-turn', message);
    assert.equal(t?.shells, 2, message);
    assert.deepEqual(t?.notify, { kind: 'yourTurn' }, message);
  }
  assert.equal(asking('Tests run; is it fine? Waiting for them.')?.status, 'working');
  assert.equal(asking('See https://x.dev/?a=1')?.status, 'working');
});

test('servers and watchers in the background do not hold the turn', () => {
  const shell = (command: string) => ({ id: 'b', type: 'shell', status: 'running', description: '', command });
  for (const command of [
    'npm run dev',
    'pnpm dev --port 5174',
    'cd web && npx vite',
    'uv run python manage.py runserver 0.0.0.0:8000',
    'uvicorn app:app --reload',
    'tsc --watch',
    'tail -f /var/log/x.log',
    'docker compose up web',
  ]) {
    const t = transition('working', 'Stop', { background_tasks: [shell(command)] });
    assert.equal(t?.status, 'your-turn', command);
    assert.equal(t?.shells, 1, command);
  }
  for (const command of ['npm test', 'npx vite build', 'npm ci --include=dev', 'docker compose up -d', 'pytest']) {
    assert.equal(transition('working', 'Stop', { background_tasks: [shell(command)] })?.background, true, command);
  }
});

test('permission request carries tool and command summary', () => {
  const t = transition('working', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf  x\n' } });
  assert.equal(t?.status, 'needs-you');
  assert.deepEqual(t?.pendingPermission, { tool: 'Bash', summary: 'rm -rf x' });
  assert.deepEqual(t?.notify, { kind: 'needsYou', text: 'Bash: rm -rf x' });
});

test('a question shows its text and choices, not JSON', () => {
  const questions = [
    { question: 'How should I open it?', options: [{ label: 'Worktree' }, { label: 'Checkout' }] },
    { question: 'Run tests?', options: [] },
  ];
  const t = transition('working', 'PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions } });
  assert.deepEqual(t?.notify, { kind: 'needsYou', text: 'How should I open it? (Worktree / Checkout) +1 more' });
});

test('notification: permission prompt needs you, but no second push after a permission request', () => {
  const p = { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' };
  assert.equal(transition('working', 'Notification', p)?.notify?.kind, 'needsYou');
  assert.deepEqual(transition('needs-you', 'Notification', p), { status: 'needs-you' });
  assert.equal(transition('your-turn', 'Notification', { notification_type: 'idle_prompt' })?.status, 'needs-you');
  assert.equal(transition('new', 'Notification', { notification_type: 'idle_prompt' }), null);
  assert.equal(transition('working', 'Notification', { notification_type: 'auth_success', message: 'ok' }), null);
});

test('a tool that ran after a permission question means working again', () => {
  const p = { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} };
  assert.deepEqual(transition('needs-you', 'PostToolUse', p), {
    status: 'working',
    pendingPermission: null,
    pendingCommands: null,
  });
  assert.equal(transition('working', 'PostToolUse', p), null);
  assert.equal(transition('your-turn', 'PostToolUse', p), null);
});

test('summaries are truncated and fall back to JSON', () => {
  assert.equal(summarizeTool({ command: 'x'.repeat(500) }).length, 200);
  assert.equal(summarizeTool({ a: 1 }), '{"a":1}');
  assert.equal(summarizeTool(null), '');
});

test('SessionStart: /clear, compact and startup bring a new Claude session id, resume does not', () => {
  const old = '11111111-1111-4111-8111-111111111111';
  const fresh = '22222222-2222-4222-8222-222222222222';
  assert.equal(transition('your-turn', 'SessionStart', { source: 'clear', session_id: fresh }), null);
  for (const source of ['clear', 'compact', 'startup']) {
    assert.equal(newClaudeSessionId(old, { source, session_id: fresh }), fresh, source);
  }
  assert.equal(newClaudeSessionId(old, { source: 'clear', session_id: old }), null, 'same id');
  assert.equal(newClaudeSessionId(old, { source: 'resume', session_id: fresh }), null, 'resume');
  assert.equal(newClaudeSessionId(old, { source: 'clear', session_id: '../x' }), null, 'not a uuid');
});

test('a waiting session parks again after a turn and ignores the idle reminder', () => {
  assert.equal(transition('waiting', 'UserPromptSubmit', { prompt: 'check the MR' }, true)?.status, 'working');
  assert.deepEqual(transition('working', 'Stop', {}, true), {
    status: 'waiting',
    pendingPermission: null,
    pendingCommands: null,
    shells: 0,
  });
  assert.equal(transition('waiting', 'Notification', { notification_type: 'idle_prompt' }, true), null);
  const ask = transition('working', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }, true);
  assert.equal(ask?.status, 'needs-you');
});

const HANDOVER = [
  'Changing git state in ~, so please run this yourself:',
  '',
  '```bash shub-run',
  '$ cd ~ && git pull',
  '```',
  '',
  'Also:',
  '',
  '```shub-run',
  'sudo systemctl restart x',
  '```',
].join('\n');

test('stop with commands to run means needs you, with the commands', () => {
  const t = transition('working', 'Stop', { last_assistant_message: HANDOVER });
  assert.equal(t?.status, 'needs-you');
  assert.deepEqual(t?.pendingCommands, ['cd ~ && git pull', 'sudo systemctl restart x']);
  assert.deepEqual(t?.notify, { kind: 'needsYou', text: 'Run: cd ~ && git pull (+1 more)' });
});

test('only blocks marked shub-run count', () => {
  assert.deepEqual(handedOverCommands('Please run this yourself:\n\n```bash\nnpm test\n```\n'), []);
  const mixed = '```python\nprint(1)\n```\ntext\n```bash\nls\n```\n```bash shub-run\nmake\n```\n';
  assert.deepEqual(handedOverCommands(mixed), ['make']);
  assert.deepEqual(handedOverCommands(undefined), []);
});
