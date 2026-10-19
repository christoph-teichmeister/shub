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
  assert.ok(s.hooks.SessionStart && s.hooks.Stop && s.hooks.PostToolUse);
  assert.match(JSON.stringify(s.hooks.PreToolUse), /"matcher":"Bash\|Edit\|Write\|MultiEdit\|NotebookEdit".*guard\.sh/);
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
  await hook('PostToolUse', { tool_name: 'Bash', permission_mode: 'acceptEdits' });
  await hook('Stop', { permission_mode: 'nonsense' });
  await hook('Stop', {});
  assert.deepEqual(modes, ['auto', 'bypassPermissions', 'acceptEdits']);
});

test('the guard denies changes to a protected main checkout and stays quiet otherwise', async () => {
  let mainCheckout: object | undefined = { branch: 'develop', updateMinutes: 15 };
  const services = {
    sessions: { get: (id: string) => (id === 's1' ? { id: 's1', projectId: 'p' } : undefined) },
    config: { project: () => ({ id: 'p', path: '/no/such/repo', mainCheckout }) },
  } as unknown as Services;
  const handlers: Record<string, (req: Request) => Promise<unknown>> = {};
  const router = {
    add: (spec: string, h: (req: Request) => Promise<unknown>) => (handlers[spec] = h),
  } as unknown as Router;
  create({} as Context, services).module.routes!(router);
  const ask = (command: string, caller = 'session:s1') =>
    handlers['POST /api/guard']!({
      caller: { id: caller },
      json: async () => ({ cwd: '/no/such/repo', tool_name: 'Bash', tool_input: { command } }),
    } as unknown as Request);

  const denied = (await ask('git checkout -b fix/x')) as { hookSpecificOutput: Record<string, string> };
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await ask('git fetch'), {});
  mainCheckout = undefined;
  assert.deepEqual(await ask('git checkout -b fix/x'), {});
  await assert.rejects(ask('git status', 'user'), /only answers shub sessions/);
});
