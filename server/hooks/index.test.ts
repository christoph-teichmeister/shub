import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Router } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { Services } from '../services.ts';
import { create, hookSettings } from './index.ts';

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

test('a hook reports the permission mode Claude runs in (for "inherit")', async () => {
  const modes: string[] = [];
  const services = {
    sessions: {
      get: () => ({ id: 's1', status: 'working', claudeSessionId: null }),
      setPermissionMode: (_id: string, mode: string) => modes.push(mode),
      setStatus: () => {},
    },
    notify: { yourTurn: () => {}, needsYou: () => {} },
  } as unknown as Services;
  let handler!: (req: Request) => Promise<unknown>;
  const router = { add: (_spec: string, h: typeof handler) => (handler = h) } as unknown as Router;
  create({} as Context, services).module.routes!(router);
  const hook = (event: string, payload: object) =>
    handler({ caller: { id: 'session:s1' }, params: { event }, json: async () => payload } as unknown as Request);
  await hook('UserPromptSubmit', { permission_mode: 'auto' });
  await hook('SessionStart', { source: 'resume', permission_mode: 'bypassPermissions' });
  await hook('Stop', { permission_mode: 'nonsense' });
  await hook('Stop', {});
  assert.deepEqual(modes, ['auto', 'bypassPermissions']);
});
