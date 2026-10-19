import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, PluginInfo, ServerEvent } from '../../shared/api.ts';
import { HttpError, Router, type Caller } from '../api/router.ts';
import { EventBus, type Context } from '../context.ts';
import type { Services } from '../services.ts';
import { decide, rightsFor } from '../permissions/rules.ts';
import { create, EXTRA_ROUTES } from './index.ts';
import { PluginProcess } from './supervisor.ts';

const user: Caller = { kind: 'user', id: 'chris', rights: rightsFor('user') };
const session: Caller = { kind: 'session', id: 'session:s1', rights: ['read'] };

function setup() {
  const configDir = mkdtempSync(join(tmpdir(), 'shub-plugins-'));
  const dir = join(configDir, 'plugins', 'demo');
  mkdirSync(dir, { recursive: true });
  // The "plugin" prints its env and then stays alive.
  writeFileSync(
    join(dir, 'p.mjs'),
    'console.log("hi", process.env.SHUB_PLUGIN_NAME, process.env.SHUB_TOKEN); setInterval(() => {}, 1000);',
  );
  writeFileSync(
    join(dir, 'shub-plugin.json'),
    JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      start: [process.execPath, 'p.mjs'],
      rights: ['read', 'ui.contribute'],
      contributes: { sidebarSections: [{ id: 'main', title: 'Main' }], settingsActions: [{ id: 'go', label: 'Go' }] },
    }),
  );
  const bus = new EventBus();
  const events: ServerEvent[] = [];
  bus.on((e) => events.push(e));
  const config = { plugins: [] } as unknown as Config;
  const tokens = new Set<string>();
  const services = {
    config: {
      get: () => config,
      update: (mutate: (c: Config) => void) => (mutate(config), bus.emit({ type: 'config.changed' }), config),
    },
    auth: {
      issueClientToken: (c: Caller) => {
        const t = `tok-${c.id}-${c.rights.join('+')}`;
        tokens.add(t);
        return t;
      },
      revokeClientToken: (t: string) => tokens.delete(t),
    },
    permissions: { decide: (c: Caller, a: never) => decide(c, a, { recentAutoStarts: 0 }), log: () => ({}) },
  } as unknown as Services;
  const ctx = { paths: { configDir }, host: '127.0.0.1', port: 1, bus } as Context;
  const { module } = create(ctx, services);
  const router = new Router();
  module.routes!(router);
  async function call(spec: string, caller: Caller, body?: unknown) {
    const [method, path] = spec.split(' ');
    const m = router.match(method, path)!;
    const req = { method, path, params: m.params, query: new URLSearchParams(), caller, json: async () => body };
    return m.route.handler(req as never, {} as never);
  }
  return { module, call, config, events, tokens, dir };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(check(), 'condition not reached');
};

test('plugin lifecycle: listed disabled, enabled with grants, sections, actions, logs, disabled', async () => {
  const { module, call, config, events, tokens } = setup();
  await module.start!();
  let list = (await call('GET /api/plugins', user)) as PluginInfo[];
  assert.equal(list[0].enabled, false);
  assert.equal(list[0].running, false);

  await assert.rejects(call('PATCH /api/plugins/demo', session, { enabled: true }), HttpError);
  await assert.rejects(call('PATCH /api/plugins/demo', user, { grantedRights: ['projects.write'] }), /not requested/);

  const info = (await call('PATCH /api/plugins/demo', user, {
    enabled: true,
    grantedRights: ['ui.contribute'],
  })) as PluginInfo;
  assert.equal(info.running, true);
  assert.deepEqual(config.plugins, [{ name: 'demo', enabled: true, grantedRights: ['ui.contribute'] }]);
  await waitFor(() => tokens.has('tok-plugin:demo-ui.contribute'));

  const logs = async () => ((await call('GET /api/plugins/demo/logs', user)) as { lines: string[] }).lines;
  for (let i = 0; i < 100 && !(await logs()).some((l) => l.includes('hi demo tok-plugin:demo')); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok((await logs()).some((l) => l.includes('hi demo tok-plugin:demo-ui.contribute')));

  const plugin: Caller = { kind: 'plugin', id: 'plugin:demo', rights: ['ui.contribute'] };
  const other: Caller = { kind: 'plugin', id: 'plugin:other', rights: ['ui.contribute'] };
  await call('PUT /api/plugins/demo/sections/main', plugin, { entries: [{ id: '1', title: 'One' }] });
  await assert.rejects(call('PUT /api/plugins/demo/sections/main', other, { entries: [] }), /own sections/);
  await assert.rejects(call('PUT /api/plugins/demo/sections/nope', plugin, { entries: [] }), /not declared/);
  await assert.rejects(
    call('PUT /api/plugins/demo/sections/main', { ...plugin, rights: [] }, { entries: [] }),
    /ui.contribute/,
  );
  list = (await call('GET /api/plugins', user)) as PluginInfo[];
  assert.deepEqual(list[0].sections[0].content, { badge: null, entries: [{ id: '1', title: 'One' }] });

  await call('POST /api/plugins/demo/actions/go', user, { sessionId: 's1', evil: 1 });
  assert.deepEqual(events.at(-1), {
    type: 'plugin.action',
    plugin: 'demo',
    actionId: 'go',
    context: { sessionId: 's1' },
  });
  await assert.rejects(call('POST /api/plugins/demo/actions/go', plugin, {}), /clicked by you/);
  await assert.rejects(call('POST /api/plugins/demo/actions/nope', user, {}), /not declared/);

  await call('PATCH /api/plugins/demo', user, { enabled: false });
  list = (await call('GET /api/plugins', user)) as PluginInfo[];
  assert.equal(list[0].running, false);
  assert.equal(list[0].sections[0].content, null);
  await waitFor(() => tokens.size === 0);
  await module.stop!();
});

test('remove stops the plugin, deletes its folder and config entry', async () => {
  const { module, call, config, dir } = setup();
  await module.start!();
  await call('PATCH /api/plugins/demo', user, { enabled: true });
  await call(EXTRA_ROUTES.pluginRemove.replace(':name', 'demo'), user);
  assert.equal(existsSync(dir), false);
  assert.deepEqual(config.plugins, []);
  await assert.rejects(call('DELETE /api/plugins/..', user), /invalid plugin name/);
  await module.stop!();
});

test('supervisor restarts a crashing plugin with backoff and keeps 500 log lines', async () => {
  let spawns = 0;
  let released = 0;
  const proc = new PluginProcess({
    name: 'crash',
    dir: tmpdir(),
    command: [process.execPath, '-e', 'for (let i = 0; i < 400; i++) console.log("line " + i); process.exit(3)'],
    env: () => (spawns++, { vars: {}, release: () => released++ }),
    backoff: { minMs: 10, maxMs: 40 },
  });
  proc.start();
  await waitFor(() => spawns >= 3);
  await proc.stop();
  assert.ok(released >= 2);
  assert.equal(proc.logs.length, 500);
  assert.ok(proc.logs.some((l) => l.includes('exited (3)')));
  assert.equal(proc.running, false);
});
