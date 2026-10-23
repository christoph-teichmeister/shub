import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { SyncSettings } from '../../shared/api.ts';
import { compareVersions, conflictViews, GroupStore } from './index.ts';
import { HostSync } from './sync.ts';

interface Host {
  group: GroupStore;
  sync: HostSync;
  settings: SyncSettings;
  merged: number;
  online: boolean;
}

/** Hosts reach each other through a fake network: the URL's host picks the receiving HostSync. */
function hosts(...names: string[]): Record<string, Host> {
  const all: Record<string, Host> = {};
  const net = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const to = all[u.hostname];
    if (!to?.online) throw new TypeError('fetch failed');
    const token = /^Bearer (.+)$/.exec((init.headers as Record<string, string>).authorization ?? '')?.[1];
    try {
      const body = await to.sync.handle(u.pathname.split('/').pop() as never, JSON.parse(init.body as string), token);
      return new Response(JSON.stringify(body), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: (err as { status: number }).status,
      });
    }
  }) as typeof fetch;
  for (const name of names) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE migrations (module TEXT NOT NULL, step INTEGER NOT NULL, PRIMARY KEY (module, step))');
    const group = new GroupStore(db, (_m, statements) => statements.forEach((s) => db.exec(s)));
    const host: Host = { group, settings: {}, merged: 0, online: true } as Host;
    host.sync = new HostSync(group, {
      sync: () => host.settings,
      url: () => `https://${name}`,
      onMerged: () => host.merged++,
      fetch: net,
      name,
    });
    host.sync.announce();
    all[name] = host;
  }
  return all;
}

/** Two hosts that already know each other, the way the join flow will leave them. */
async function pair() {
  const { a, b } = hosts('a', 'b');
  a.group.merge(b.group.get(`device:${b.group.hostId}`)!);
  b.group.merge(a.group.get(`device:${a.group.hostId}`)!);
  return { a, b };
}

test('hosts are members of the group with their URL and key', () => {
  const { a } = hosts('a');
  const item = a.group.get(`device:${a.group.hostId}`)!;
  assert.equal((item.body as { url: string }).url, 'https://a');
  assert.equal((item.body as { kind: string }).kind, 'host');
  assert.equal(a.sync.peers().length, 0);
});

test('a host learns of another host from the group and dials it', async () => {
  const { a, b } = await pair();
  assert.deepEqual(
    a.sync.peers().map((p) => p.url),
    ['https://b'],
  );
  await a.sync.round();
  assert.equal(a.sync.peers()[0].state, 'in-sync');
  assert.ok(b.group.get(`device:${a.group.hostId}`));
});

test('a push reaches every reachable host at once', async () => {
  const { a, b } = await pair();
  await a.sync.round();
  a.group.put('project:p', { id: 'p', name: 'p', path: '~/p', order: 0 });
  await a.sync.flush();
  assert.deepEqual(b.group.get('project:p')?.body, { id: 'p', name: 'p', path: '~/p', order: 0 });
  assert.ok(b.merged > 0); // the config was reloaded
});

test('a host that was offline catches up with everything it missed', async () => {
  const { a, b } = await pair();
  await a.sync.round();
  b.online = false;
  a.group.put('theme:t', { id: 't' });
  a.group.put('setting:terminal', { fontSize: 15 });
  await a.sync.flush();
  assert.equal(a.sync.peers()[0].state, 'offline');
  assert.ok(a.sync.peers()[0].since);
  assert.equal(b.group.get('theme:t'), undefined);
  b.online = true;
  await b.sync.round(); // b starts and pulls
  assert.deepEqual(b.group.get('theme:t')?.body, { id: 't' });
  assert.deepEqual(b.group.get('setting:terminal')?.body, { fontSize: 15 });
  await a.sync.round(); // a's timer brings its state back
  assert.equal(a.sync.peers()[0].state, 'in-sync');
  assert.equal(a.sync.peers()[0].since, undefined);
});

test('two hosts that were apart converge; a real conflict stays open on both sides', async () => {
  const { a, b } = await pair();
  await a.sync.round();
  b.online = false;
  a.group.put('project:x', { id: 'x', v: 'a' });
  a.group.put('theme:t', { id: 't', v: 'a' });
  b.group.put('project:y', { id: 'y', v: 'b' });
  b.group.put('theme:t', { id: 't', v: 'b' }); // the same item, changed on both
  await a.sync.flush();
  b.online = true;
  await a.sync.round();
  for (const key of ['project:x', 'project:y']) assert.deepEqual(a.group.get(key), b.group.get(key));
  assert.deepEqual(a.group.get('theme:t')?.body, { id: 't', v: 'a' }); // neither was overwritten
  assert.deepEqual(b.group.get('theme:t')?.body, { id: 't', v: 'b' });
  assert.equal(a.group.conflicts().length, 1);
  assert.equal(b.group.conflicts().length, 1);
  assert.equal(a.sync.peers()[0].state, 'conflict');
});

test('an unreachable host is marked offline and does not stop the others', async () => {
  const { a, b, c } = hosts('a', 'b', 'c');
  for (const [x, y] of [
    [a, b],
    [a, c],
    [b, c],
  ] as const) {
    x.group.merge(y.group.get(`device:${y.group.hostId}`)!);
    y.group.merge(x.group.get(`device:${x.group.hostId}`)!);
  }
  b.online = false;
  a.group.put('theme:t', { id: 't' });
  await a.sync.flush();
  const states = Object.fromEntries(a.sync.peers().map((p) => [p.name, p.state]));
  assert.deepEqual(states, { b: 'offline', c: 'in-sync' });
  assert.ok(c.group.get('theme:t'));
});

test('a revoked host is refused: no sign-in, and a token it holds stops working', async () => {
  const { a, b } = await pair();
  await b.sync.round();
  assert.equal(b.sync.peers()[0].state, 'in-sync');
  a.group.remove(`device:${b.group.hostId}`); // revoke on a
  b.group.put('project:evil', { id: 'evil' });
  await b.sync.flush(); // its token still exists, but a checks the group on every call
  assert.equal(a.group.get('project:evil'), undefined);
  assert.equal(b.sync.peers()[0].state, 'offline');
  await b.sync.round(); // a new sign-in is refused too
  assert.throws(() => a.sync.handle('challenge', { hostId: b.group.hostId }), /not a host/);
  assert.equal(a.group.get('project:evil'), undefined);
});

test('a revoked host cannot bring itself back', async () => {
  const { a, b } = await pair();
  a.group.remove(`device:${b.group.hostId}`);
  b.group.merge(a.group.get(`device:${b.group.hostId}`)!); // b learns its tombstone
  b.sync.announce();
  assert.ok(b.sync.revoked);
  assert.equal(b.group.get(`device:${b.group.hostId}`)!.deleted, true);
  assert.notEqual(a.group.merge(b.group.get(`device:${b.group.hostId}`)!), 'newer');
  assert.equal(a.group.get(`device:${b.group.hostId}`)!.deleted, true);
});

test('a signature from another key does not sign a host in', async () => {
  const { a, b } = await pair();
  const { nonce } = a.sync.handle('challenge', { hostId: b.group.hostId }) as { nonce: string };
  const forged = Buffer.alloc(64, 1).toString('base64url');
  assert.throws(() => a.sync.handle('session', { hostId: b.group.hostId, nonce, signature: forged }), /bad signature/);
  assert.throws(() => a.sync.handle('pull', {}, 'nope'), /sign in/);
});

test('categories that are switched off neither travel nor are accepted', async () => {
  const { a, b } = await pair();
  a.settings = { themes: false };
  a.group.put('theme:t', { id: 't' });
  a.group.put('project:p', { id: 'p' });
  await a.sync.round();
  assert.equal(b.group.get('theme:t'), undefined);
  assert.ok(b.group.get('project:p'));
  b.group.put('theme:u', { id: 'u' });
  await b.sync.round();
  assert.equal(a.group.get('theme:u'), undefined); // a refuses what it has switched off
});

test('plugin env does not travel unless switched on', async () => {
  const { a, b } = await pair();
  a.group.put('plugin:x', { name: 'x', env: { K: 'secret' } });
  await a.sync.round();
  assert.deepEqual(b.group.get('plugin:x')?.body, { name: 'x' });
});

/** Two hosts that changed the same theme while apart, now meeting: a conflict open on both. */
async function conflicted() {
  const { a, b } = await pair();
  await a.sync.round();
  b.online = false;
  a.group.put('theme:t', { id: 't', v: 'a' });
  b.group.put('theme:t', { id: 't', v: 'b' });
  await a.sync.flush();
  b.online = true;
  await a.sync.round();
  return { a, b };
}

test('a conflict shows both versions with the hosts that made them', async () => {
  const { a } = await conflicted();
  const [c] = conflictViews(a.group);
  assert.deepEqual([c.key, c.ours.hosts, c.theirs.hosts], ['theme:t', ['a'], ['b']]);
  assert.deepEqual(
    [c.ours.body, c.theirs.body],
    [
      { id: 't', v: 'a' },
      { id: 't', v: 'b' },
    ],
  );
});

test('a pick on one host closes the conflict on the others', async () => {
  const { a, b } = await conflicted();
  const theirsBefore = a.group.get('theme:t')!.version;
  assert.equal(b.group.resolve('theme:t', 'ours'), true); // b keeps its own version
  await b.sync.flush();
  for (const h of [a, b]) {
    assert.deepEqual(h.group.get('theme:t')?.body, { id: 't', v: 'b' });
    assert.equal(h.group.conflicts().length, 0);
  }
  assert.equal(compareVersions(b.group.get('theme:t')!.version, theirsBefore), 'newer'); // supersedes both
  assert.deepEqual(a.group.get('theme:t'), b.group.get('theme:t'));
  assert.equal(b.group.resolve('theme:t', 'ours'), false);
});

test('a pick reaches a host that was offline when it was made', async () => {
  const { a, b } = await conflicted();
  b.online = false;
  a.group.resolve('theme:t', 'theirs'); // a takes b's version
  await a.sync.flush();
  assert.equal(b.group.conflicts().length, 1); // b has not heard yet
  b.online = true;
  await a.sync.round();
  assert.deepEqual(b.group.get('theme:t')?.body, { id: 't', v: 'b' });
  assert.equal(b.group.conflicts().length, 0);
  assert.equal(a.group.conflicts().length, 0);
});

test('a revoke is never a conflict', async () => {
  const { a, b } = await pair();
  await a.sync.round();
  b.online = false;
  const id = b.group.hostId;
  a.group.remove(`device:${id}`); // a revokes b
  b.group.put(`device:${id}`, { ...(b.group.get(`device:${id}`)!.body as object), name: 'renamed' });
  const mine = a.group.get(`device:${id}`)!;
  assert.equal(a.group.merge(b.group.get(`device:${id}`)!), 'older');
  assert.equal(a.group.conflicts().length, 0);
  assert.equal(a.group.get(`device:${id}`)!.deleted, mine.deleted);
});

test('a revoke reaching the host that edited the device item deletes it without a conflict', async () => {
  const { a, b } = await pair();
  await a.sync.round();
  const id = b.group.hostId;
  b.online = false;
  a.group.remove(`device:${id}`);
  b.group.put(`device:${id}`, { ...(b.group.get(`device:${id}`)!.body as object), name: 'renamed' });
  assert.equal(b.group.merge(a.group.get(`device:${id}`)!), 'newer');
  assert.equal(b.group.get(`device:${id}`)!.deleted, true);
  assert.equal(b.group.conflicts().length, 0);
});

test('a revoke is never a conflict over a round either', async () => {
  const { a, b } = await pair();
  await a.sync.round();
  const id = b.group.hostId;
  b.online = false;
  a.group.remove(`device:${id}`);
  b.group.put(`device:${id}`, { ...(b.group.get(`device:${id}`)!.body as object), name: 'renamed' });
  b.online = true;
  await a.sync.round();
  await b.sync.round();
  assert.equal(a.group.conflicts().length, 0);
  assert.equal(b.group.conflicts().length, 0);
  assert.equal(a.group.get(`device:${id}`)!.deleted, true);
});
