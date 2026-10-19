import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookSettings } from './index.ts';

test('session settings hook every event and keep Claude tools off the secrets in stateDir', () => {
  const s = hookSettings('/app', '/home/u/.local/state/shub/') as {
    hooks: Record<string, unknown>;
    permissions: { deny: string[] };
  };
  assert.ok(s.hooks.SessionStart && s.hooks.Stop);
  assert.deepEqual(s.permissions.deny, [
    'Read(//home/u/.local/state/shub/token)',
    'Read(//home/u/.local/state/shub/shub.db*)',
    'Read(//home/u/.local/state/shub/vapid.json)',
    'Edit(//home/u/.local/state/shub/**)',
    'Write(//home/u/.local/state/shub/**)',
  ]);
});
