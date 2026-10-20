import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newClaudeSessionId, summarizeTool, transition } from './transition.ts';

test('prompt submit means working and clears a pending question', () => {
  assert.deepEqual(transition('your-turn', 'UserPromptSubmit', { prompt: 'hi' }), {
    status: 'working',
    pendingPermission: null,
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
  assert.equal(transition('working', 'Notification', { notification_type: 'idle_prompt' }), null);
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
  assert.deepEqual(transition('needs-you', 'PostToolUse', p), { status: 'working', pendingPermission: null });
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
  assert.deepEqual(transition('working', 'Stop', {}, true), { status: 'waiting', pendingPermission: null });
  assert.equal(transition('waiting', 'Notification', { notification_type: 'idle_prompt' }, true), null);
  const ask = transition('working', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }, true);
  assert.equal(ask?.status, 'needs-you');
});
