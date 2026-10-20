import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent, UpdateStatus } from '../../shared/api.ts';
import { HttpError, Router, type Caller } from '../api/router.ts';
import { FileConfigStore } from '../config/index.ts';
import { EventBus, type Context } from '../context.ts';
import { rightsFor } from '../permissions/rules.ts';
import type { Services } from '../services.ts';
import { openState } from '../state/index.ts';
import { create } from './index.ts';

const user: Caller = { kind: 'user', id: 'chris', rights: rightsFor('user') };
const cli: Caller = { kind: 'cli', id: 'cli', rights: rightsFor('cli') };
const session: Caller = { kind: 'session', id: 'session:s1', rights: ['read'] };

// Fake launcher: answers `update --check` per channel, records every other call.
const FAKE_LAUNCHER = `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--check')) {
  if (process.env.FAKE_FAIL) {
    console.error('shub: GET https://api.github.com/repos/x/releases failed: 403 rate limit exceeded');
    process.exit(1);
  }
  const beta = args.at(-1) === 'beta';
  const latest = beta ? '2026.11.0-beta.1' : '2026.10.1';
  console.log(JSON.stringify({ current: '2026.10.0', channel: args.at(-1), latest, changelog: '## ' + latest + '\\n\\nnotes' }));
} else appendFileSync(process.env.FAKE_OUT, JSON.stringify(args) + '\\n');
`;

function setup(withLauncher: boolean, extraEnv: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shub-updates-'));
  const appDir = join(root, 'app');
  mkdirSync(appDir);
  writeFileSync(join(appDir, 'package.json'), '{"version":"2026.10.0"}');
  writeFileSync(join(root, 'launcher.mjs'), FAKE_LAUNCHER);
  const bus = new EventBus();
  const events: ServerEvent[] = [];
  bus.on((e) => events.push(e));
  const logged: string[] = [];
  const services = {
    state: openState(join(root, 'state')),
    config: new FileConfigStore(join(root, 'config'), bus),
    permissions: { log: (e: { action: string; detail: string }) => logged.push(`${e.action} ${e.detail}`) },
  } as unknown as Services;
  const ctx = { paths: { appDir }, bus } as Context;
  const home = join(root, 'home');
  const out = join(root, 'launcher-calls');
  const env = {
    ...(withLauncher && { SHUB_LAUNCHER: join(root, 'launcher.mjs') }),
    SHUB_HOME: home,
    SHUB_RELEASE_FEED: '',
    FAKE_OUT: out,
    ...extraEnv,
  };
  const { module } = create(ctx, services, env);
  const router = new Router();
  module.routes!(router);
  async function call<T = UpdateStatus>(spec: string, caller: Caller, body?: unknown): Promise<T> {
    const [method, path] = spec.split(' ');
    const m = router.match(method, path)!;
    const req = { method, path, params: m.params, caller, json: async () => body ?? {} };
    return (await m.route.handler(req as never, {} as never)) as T;
  }
  const calls = async (n: number): Promise<string[][]> => {
    for (let i = 0; i < 100 && (!existsSync(out) || readFileSync(out, 'utf8').split('\n').length <= n); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return readFileSync(out, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  };
  return { module, call, events, logged, home, calls, services };
}

const changed = async (events: ServerEvent[], n = 1) => {
  for (let i = 0; i < 200 && events.filter((e) => e.type === 'updates.changed').length < n; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('from a git checkout the updates are read-only', async () => {
  const { module, call } = setup(false);
  module.start!();
  assert.deepEqual(await call('GET /api/updates', user), {
    current: '2026.10.0',
    channel: 'stable',
    mode: 'ask',
    managedBy: 'git',
    checkedAt: null,
  });
  await assert.rejects(call('POST /api/updates/check', user), /managed by git/);
  await assert.rejects(call('POST /api/updates/install', user, { version: '2026.10.1' }), /managed by git/);
  await assert.rejects(call('PATCH /api/updates/channel', user, { channel: 'beta' }), /managed by git/);
  await assert.rejects(call('PATCH /api/updates/mode', user, { mode: 'auto' }), /managed by git/);
  await assert.rejects(call('GET /api/updates', session), HttpError);
});

test('periodic check through the launcher, cached per version and channel', async () => {
  const { module, call, events, services } = setup(true);
  module.start!();
  await changed(events);
  const status = await call('GET /api/updates', user);
  assert.equal(status.managedBy, 'launcher');
  assert.equal(status.latest, '2026.10.1');
  assert.equal(status.changelog, '## 2026.10.1\n\nnotes');
  assert.ok(status.checkedAt);

  await assert.rejects(call('PATCH /api/updates/channel', cli, { channel: 'beta' }), /only you/);
  await assert.rejects(call('PATCH /api/updates/channel', user, { channel: 'nightly' }), /stable or beta/);
  const switched = await call('PATCH /api/updates/channel', user, { channel: 'beta' });
  assert.equal(switched.channel, 'beta');
  assert.equal(switched.latest, undefined, 'the stable result does not count for beta');
  assert.equal(services.config.get().updateChannel, 'beta');
  await changed(events, 2);
  assert.equal((await call('GET /api/updates', user)).latest, '2026.11.0-beta.1');
  module.stop!();
});

test('a message on the release feed starts a check right away', async () => {
  let stream: ServerResponse | undefined;
  const feed = createServer((_req, res) => {
    res.write('{"event":"open"}\n');
    stream = res;
  });
  await new Promise<void>((r) => feed.listen(0, '127.0.0.1', r));
  const { port } = feed.address() as { port: number };
  const { module, events, services } = setup(true, { SHUB_RELEASE_FEED: `http://127.0.0.1:${port}/json` });
  try {
    module.start!();
    await changed(events);
    for (let i = 0; i < 100 && !stream; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(events.filter((e) => e.type === 'updates.changed').length, 1, 'connect right after a check: no 2nd');

    services.state.db.prepare("UPDATE update_check SET checked_at = '2000-01-01T00:00:00Z'").run();
    stream!.write('{"event":"keepalive"}\n{"event":"message","message":"2026.10.1"}\n');
    await changed(events, 2);
    assert.equal(events.filter((e) => e.type === 'updates.changed').length, 2);
  } finally {
    module.stop!();
    feed.closeAllConnections();
    feed.close();
  }
});

test('install and rollback start the launcher, only for the browser user', async () => {
  const { call, calls, logged, home } = setup(true);
  await call('POST /api/updates/check', user);
  await assert.rejects(call('POST /api/updates/install', cli), /only you/);
  await assert.rejects(call('POST /api/updates/install', user, { version: '../../x' }), /release version/);
  assert.deepEqual(await call('POST /api/updates/install', user), { ok: true, version: '2026.10.1' });
  assert.deepEqual(await calls(1), [['update', '--to', '2026.10.1']]);

  await assert.rejects(call('POST /api/updates/rollback', user), /no previous version/);
  const last = { at: '2026-10-19T20:00:00Z', from: '2026.10.0', to: '2026.10.1', ok: false, message: 'rolled back' };
  writeFileSync(join(home, 'launcher.json'), JSON.stringify({ previous: '2026.9.0', port: 4780, last }));
  const status = await call('GET /api/updates', user);
  assert.equal(status.previous, '2026.9.0');
  assert.deepEqual(status.last, last);
  assert.deepEqual(await call('POST /api/updates/rollback', user), { ok: true, version: '2026.9.0' });
  assert.deepEqual(await calls(2), [['update', '--to', '2026.10.1'], ['rollback']]);
  assert.deepEqual(logged, ['updates.install 2026.10.1', 'updates.rollback 2026.9.0']);
});

test('mode off skips the background check', async () => {
  const { module, call, events, services } = setup(true);
  services.config.update((c) => (c.updateMode = 'off'), 'chris');
  module.start!();
  await new Promise((r) => setTimeout(r, 300));
  module.stop!();
  assert.equal(events.filter((e) => e.type === 'updates.changed').length, 0);
  assert.equal((await call('POST /api/updates/check', user)).latest, '2026.10.1', 'Check now still works');
});

test('a failed check is shown, not thrown', async () => {
  const { call } = setup(true, { FAKE_FAIL: '1' });
  const status = await call('POST /api/updates/check', user);
  assert.equal(status.checkError, 'GET https://api.github.com/repos/x/releases failed: 403 rate limit exceeded');
  assert.equal(status.latest, undefined);
});

test('mode auto installs after the check, but not a version that was rolled back', async () => {
  const { call, calls, logged, home, services } = setup(true);
  await assert.rejects(call('PATCH /api/updates/mode', cli, { mode: 'auto' }), /only you/);
  await assert.rejects(call('PATCH /api/updates/mode', user, { mode: 'yolo' }), /auto, ask or off/);
  assert.equal((await call('POST /api/updates/check', user)).mode, 'ask');
  assert.deepEqual(logged, [], 'ask only shows the new version');

  mkdirSync(home, { recursive: true });
  const last = { at: '2026-10-19T20:00:00Z', from: '2026.10.0', to: '2026.10.1', ok: false, message: 'rolled back' };
  writeFileSync(join(home, 'launcher.json'), JSON.stringify({ last }));
  services.config.update((c) => (c.updateMode = 'auto'), 'chris');
  await call('POST /api/updates/check', user);
  assert.deepEqual(logged, [], 'the rolled-back version is not retried');

  writeFileSync(join(home, 'launcher.json'), '{}');
  assert.equal((await call('PATCH /api/updates/mode', user, { mode: 'auto' })).mode, 'auto');
  await call('POST /api/updates/check', user);
  assert.deepEqual(await calls(1), [['update', '--to', '2026.10.1']]);
  assert.equal(logged[0], 'updates.install 2026.10.1 (auto)');
});
