import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTool, transition } from './transition.ts';

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

test('permission request carries tool and command summary', () => {
  const t = transition('working', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf  x\n' } });
  assert.equal(t?.status, 'needs-you');
  assert.deepEqual(t?.pendingPermission, { tool: 'Bash', summary: 'rm -rf x' });
  assert.deepEqual(t?.notify, { kind: 'needsYou', text: 'Bash: rm -rf x' });
});

test('notification: permission prompt needs you, but no second push after a permission request', () => {
  const p = { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' };
  assert.equal(transition('working', 'Notification', p)?.notify?.kind, 'needsYou');
  assert.deepEqual(transition('needs-you', 'Notification', p), { status: 'needs-you' });
  assert.equal(transition('your-turn', 'Notification', { notification_type: 'idle_prompt' })?.status, 'needs-you');
  assert.equal(transition('working', 'Notification', { notification_type: 'auth_success', message: 'ok' }), null);
});

test('summaries are truncated and fall back to JSON', () => {
  assert.equal(summarizeTool({ command: 'x'.repeat(500) }).length, 200);
  assert.equal(summarizeTool({ a: 1 }), '{"a":1}');
  assert.equal(summarizeTool(null), '');
});
