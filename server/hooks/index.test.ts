import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Router } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { Services } from '../services.ts';
import { create, hookSettings, stableAppDir, userStatusLine } from './index.ts';

test('session settings hook every event and keep Claude tools off the secrets in stateDir', () => {
  const s = hookSettings('/app', '/home/u/.local/state/shub/') as {
    hooks: Record<string, unknown>;
    permissions: { deny: string[] };
  };
  assert.ok(s.hooks.SessionStart && s.hooks.Stop && s.hooks.PostToolUse && s.hooks.SessionEnd);
  assert.equal(s.hooks.WorktreeCreate, undefined);
  assert.match(
    JSON.stringify(s.hooks.PreToolUse),
    /report\.sh' PreToolUse.*"matcher":"Bash\|Edit\|Write\|MultiEdit\|NotebookEdit".*guard\.sh/,
  );
  assert.deepEqual(s.permissions.deny, [
    'Read(//home/u/.local/state/shub/token)',
    'Read(//home/u/.local/state/shub/shub.db*)',
    'Read(//home/u/.local/state/shub/vapid.json)',
    'Edit(//home/u/.local/state/shub/**)',
  ]);
});

test("the status line reports to shub and still draws the user's own one", () => {
  const home = mkdtempSync(join(tmpdir(), 'shub-home-'));
  const cwd = join(home, 'repo');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    '{"statusLine":{"type":"command","command":"user it\'s","padding":1}}',
  );
  writeFileSync(join(cwd, '.claude', 'settings.json'), '{"permissions":{}}');
  const line = userStatusLine(cwd, home);
  assert.deepEqual(line, { type: 'command', command: "user it's", padding: 1 });
  const s = hookSettings('/app', '/state', line) as { statusLine: { command: string; padding: number } };
  assert.equal(s.statusLine.command, `sh '/app/server/hooks/statusline.sh' 'user it'\\''s'`);
  assert.equal(s.statusLine.padding, 1);
  assert.equal((hookSettings('/app', '/state') as typeof s).statusLine.command, `sh '/app/server/hooks/statusline.sh'`);
});

test('the status line sets the window Claude Code reports', async () => {
  const set: unknown[] = [];
  const services = {
    sessions: {
      get: () => ({ id: 's1', status: 'working', context: { tokens: 170_000, window: 200_000 } }),
      setContext: (_id: string, context: unknown) => set.push(context),
    },
  } as unknown as Services;
  let handler!: (req: Request) => Promise<unknown>;
  const router = { add: (_spec: string, h: typeof handler) => (handler = h) } as unknown as Router;
  create({} as Context, services).module.routes!(router);
  const line = (payload: object) =>
    handler({
      caller: { id: 'session:s1' },
      params: { event: 'StatusLine' },
      json: async () => payload,
    } as unknown as Request);
  await line({ context_window: { context_window_size: 1_000_000 } });
  await line({ context_window: {} });
  assert.deepEqual(set, [{ tokens: 170_000, window: 1_000_000 }]);
});

test('hooks of an installed app go through current, so pruning an old version does not break sessions', () => {
  const home = mkdtempSync(join(tmpdir(), 'shub-home-'));
  const appDir = join(home, 'versions', '1.0.0');
  mkdirSync(appDir, { recursive: true });
  assert.equal(stableAppDir(`${appDir}/`), appDir);
  symlinkSync('versions/1.0.0', join(home, 'current'));
  assert.equal(stableAppDir(`${appDir}/`), join(home, 'current'));
  assert.equal(stableAppDir('/home/u/src/shub/'), '/home/u/src/shub');
});

test('a hook reports the permission mode Claude runs in (for "inherit")', async () => {
  const modes: string[] = [];
  const services = {
    sessions: {
      get: () => ({ id: 's1', status: 'working', claudeSessionId: null }),
      setPermissionMode: (_id: string, mode: string) => modes.push(mode),
      setStatus: () => {},
      started: () => {},
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
  // Hooked for later shub versions: accepted and ignored. Anything else is not a hook.
  assert.deepEqual(await hook('PreCompact', { permission_mode: 'plan' }), { ok: true });
  assert.deepEqual(modes, ['auto', 'bypassPermissions', 'acceptEdits']);
  await assert.rejects(hook('Bogus', {}), /unknown hook event/);
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

test('the first prompt names a "Session N" session, later prompts and given names stay', async () => {
  const renames: string[] = [];
  let name = 'Session 8';
  const services = {
    sessions: {
      get: () => ({ id: 's1', status: 'your-turn', claudeSessionId: null, name }),
      nameFromPrompt: (_id: string, prompt: string) => renames.push((name = prompt)),
      nameFromMr: () => {},
      setPermissionMode: () => {},
      setStatus: () => {},
    },
    notify: { yourTurn: () => {}, needsYou: () => {} },
  } as unknown as Services;
  let handler!: (req: Request) => Promise<unknown>;
  const router = { add: (_spec: string, h: typeof handler) => (handler = h) } as unknown as Router;
  create({} as Context, services).module.routes!(router);
  const hook = (event: string, payload: object) =>
    handler({ caller: { id: 'session:s1' }, params: { event }, json: async () => payload } as unknown as Request);
  await hook('UserPromptSubmit', { prompt: 'system note', source: 'system' });
  await hook('UserPromptSubmit', { prompt: '  ' });
  await hook('UserPromptSubmit', { prompt: 'fix the login redirect after logout please now' });
  await hook('UserPromptSubmit', { prompt: 'second prompt' });
  assert.deepEqual(renames, ['fix the login redirect after logout please now']);
});
