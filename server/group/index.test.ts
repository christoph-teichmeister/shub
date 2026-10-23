import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROUTES } from '../../shared/api.ts';
import { Router, type Caller } from '../api/router.ts';
import type { Context } from '../context.ts';
import { EventBus } from '../context.ts';
import type { Services } from '../services.ts';
import { openState } from '../state/index.ts';
import { compareItems, compareVersions, create, forSync, GroupStore, type GroupItem } from './index.ts';

function store(): GroupStore {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE migrations (module TEXT NOT NULL, step INTEGER NOT NULL, PRIMARY KEY (module, step))');
  return new GroupStore(db, (_module, statements) => statements.forEach((s) => db.exec(s)));
}

const item = (key: string, version: Record<string, number>, deleted = false, body: unknown = {}): GroupItem => ({
  key,
  body: deleted ? null : body,
  version,
  deleted,
});

test('add, change and delete bump this host counter; delete leaves a tombstone', () => {
  const g = store();
  assert.deepEqual(g.put('project:a', { n: 1 }).version, { [g.hostId]: 1 });
  assert.deepEqual(g.put('project:a', { n: 2 }).version, { [g.hostId]: 2 });
  assert.deepEqual(g.get('project:a')?.body, { n: 2 });
  g.remove('project:a');
  assert.equal(g.get('project:a')?.deleted, true);
  assert.equal(g.get('project:a')?.version[g.hostId], 3);
  assert.equal(g.remove('project:a'), undefined); // already gone: no new version
  assert.equal(g.remove('project:never'), undefined);
});

test('version compare: newer, older, equal, conflict', () => {
  assert.equal(compareVersions({ a: 1 }, { a: 1 }), 'equal');
  assert.equal(compareVersions({}, {}), 'equal');
  assert.equal(compareVersions({ a: 2 }, { a: 1 }), 'newer');
  assert.equal(compareVersions({ a: 1, b: 1 }, { a: 1 }), 'newer');
  assert.equal(compareVersions({ a: 1 }, { a: 1, b: 1 }), 'older');
  assert.equal(compareVersions({ a: 2 }, { a: 1, b: 1 }), 'conflict');
});

test('a revoked device always wins; an ordinary delete is a conflict', () => {
  const edited = item('device:d', { a: 1, b: 1 });
  const revoked = item('device:d', { a: 1, c: 1 }, true);
  assert.equal(compareItems(revoked, edited), 'newer');
  assert.equal(compareItems(edited, revoked), 'older');
  assert.equal(compareItems(item('project:p', { c: 1 }, true), item('project:p', { b: 1 })), 'conflict');
});

test('merge takes newer, ignores older and equal, parks a conflict and keeps ours', () => {
  const g = store();
  assert.equal(g.merge(item('theme:t', { x: 1 }, false, { v: 'x1' })), 'newer'); // unknown item
  assert.equal(g.merge(item('theme:t', { x: 2 }, false, { v: 'x2' })), 'newer');
  assert.equal(g.merge(item('theme:t', { x: 1 })), 'older');
  assert.equal(g.merge(item('theme:t', { x: 2 })), 'equal');
  assert.deepEqual(g.get('theme:t')?.body, { v: 'x2' });
  g.put('theme:t', { v: 'mine' });
  assert.equal(g.merge(item('theme:t', { x: 3 }, false, { v: 'theirs' })), 'conflict');
  assert.deepEqual(g.get('theme:t')?.body, { v: 'mine' });
  assert.deepEqual(
    g.conflicts().map((c) => c.theirs.body),
    [{ v: 'theirs' }],
  );
});

test('a revoke merges over an offline edit, so the device stays removed', () => {
  const g = store();
  g.merge(item('device:d', { a: 1 }, false, { name: 'phone' }));
  g.put('device:d', { name: 'renamed' }); // this host edits while the other revokes
  assert.equal(g.merge(item('device:d', { a: 1, b: 1 }, true)), 'newer');
  assert.equal(g.get('device:d')?.deleted, true);
  assert.deepEqual(g.conflicts(), []);
});

test('config round trip: setConfig makes items, changes bump only what changed, removals tombstone', () => {
  const g = store();
  const base = {
    groups: ['A', 'B'],
    projects: [{ id: 'p', name: 'p', path: '~/p', order: 0 }],
    terminal: { fontSize: 14 },
    activeTheme: 'dracula',
    plugins: [{ name: 'x', enabled: true, grantedRights: [], env: { K: 'v' } }],
  } as never;
  g.setConfig(base);
  assert.deepEqual(g.config().groups, ['A', 'B']);
  assert.equal(g.config().activeTheme, 'dracula');
  const before = g.get('project:p')!.version;
  g.setConfig({ ...(base as object), groups: ['A'], terminal: undefined } as never);
  assert.deepEqual(g.get('project:p')!.version, before); // unchanged items keep their version
  assert.deepEqual(g.config().groups, ['A']);
  assert.equal(g.config().terminal, undefined);
  assert.equal(g.get('group:B')?.deleted, true);
});

test('devices are never touched by setConfig; importConfig runs once', () => {
  const g = store();
  g.put('device:d', { name: 'phone' });
  assert.equal(g.importConfig({ groups: ['A'] }), true);
  assert.equal(g.importConfig({ groups: ['B'] }), false);
  assert.deepEqual(g.config().groups, ['A']);
  assert.equal(g.get('device:d')?.deleted, false);
});

test('sync switches: off categories are neither sent nor accepted; plugin env is opt-in; devices always sync', () => {
  const plugin = item('plugin:x', { a: 1 }, false, { name: 'x', enabled: true, env: { K: 'v' } });
  assert.deepEqual(forSync(plugin, undefined)?.body, { name: 'x', enabled: true });
  assert.deepEqual(forSync(plugin, { pluginEnv: true })?.body, plugin.body);
  assert.equal(forSync(plugin, { plugins: false }), null);
  assert.equal(forSync(item('project:p', { a: 1 }), { projects: false }), null);
  assert.equal(forSync(item('setting:terminal', { a: 1 }), { terminal: false }), null);
  assert.equal(forSync(item('setting:defaultPermissionMode', { a: 1 }), { permissionMode: false }), null);
  assert.ok(forSync(item('setting:notifications', { a: 1 }), { terminal: false }));
  assert.ok(forSync(item('device:d', { a: 1 }), { projects: false, plugins: false }));
});

test('conflict routes are for the user only; a phone may not settle a device item', async () => {
  const state = openState(mkdtempSync(join(tmpdir(), 'shub-group-')));
  const services = { state, config: { get: () => ({}), reload: () => {} } } as unknown as Services;
  const router = new Router();
  create({ bus: new EventBus() } as Context, services).module.routes!(router);
  const call = async (spec: string, caller: Caller, body?: unknown) => {
    const [method, path] = spec.split(' ');
    return router.match(method, path)!.route.handler({ caller, json: async () => body ?? {} } as never, {} as never);
  };
  const who = (kind: Caller['kind'], level?: Caller['level']): Caller => ({ kind, id: kind, rights: [], level });
  for (const kind of ['session', 'spawned-session', 'plugin', 'global-claude'] as const) {
    await assert.rejects(call(ROUTES.groupConflicts, who(kind)), { status: 403 });
    await assert.rejects(call(ROUTES.groupResolve, who(kind), { key: 'theme:t', pick: 'ours' }), { status: 403 });
  }
  assert.deepEqual(await call(ROUTES.groupConflicts, who('user')), []);
  await assert.rejects(call(ROUTES.groupResolve, who('user', 'control'), { key: 'device:x', pick: 'ours' }), {
    status: 403,
  });
  await assert.rejects(call(ROUTES.groupResolve, who('user'), { key: 'device:x', pick: 'ours' }), { status: 404 });
});

test('join routes: refused unless auth names the caller a trusted host or an approved browser', async () => {
  const state = openState(mkdtempSync(join(tmpdir(), 'shub-group-')));
  let kind: 'approved' | 'manager' | null = null;
  let finished = 0;
  const services = {
    state,
    config: { get: () => ({}), reload: () => {} },
    auth: { joinKind: () => kind, finishJoin: () => finished++ },
  } as unknown as Services;
  const router = new Router();
  const { service } = create({ bus: new EventBus() } as Context, services);
  create({ bus: new EventBus() } as Context, services).module.routes!(router);
  const call = async (spec: string, body?: unknown) => {
    const [method, path] = spec.split(' ');
    const caller: Caller = { kind: 'user', id: 'chris', rights: [], deviceId: 'd' };
    return router
      .match(method, path)!
      .route.handler({ caller, raw: {}, json: async () => body ?? {} } as never, {} as never);
  };
  await assert.rejects(call(ROUTES.groupJoinOffer), { status: 403 }); // a pairing code alone is no consent
  await assert.rejects(call(ROUTES.groupJoin, { host: {} }), { status: 403 });
  assert.equal(finished, 0);
  kind = 'approved';
  const host = (await call(ROUTES.groupJoinOffer)) as { id: string };
  assert.equal(host.id, service.hostId);
  await assert.rejects(call(ROUTES.groupJoin, { host: { id: 'x' } }), { status: 400 });
  assert.equal(finished, 0); // a failed join does not use up the approval
});
