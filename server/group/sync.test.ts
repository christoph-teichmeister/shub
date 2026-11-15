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

test('a burst of changes is pushed by one flush, then the next change schedules another', async () => {
  const { a } = hosts('a');
  let flushes = 0;
  a.sync.flush = async () => void flushes++;
  for (let i = 0; i < 50; i++) a.group.put(`plugin:p${i}`, { name: `p${i}` });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(flushes, 1);
  a.group.put('plugin:p0', { name: 'again' });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(flushes, 2);
  a.sync.stop();
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

test("join: two strangers carry each other's info and end up in one group; only devices cross the link", async () => {
  const { a, b } = hosts('a', 'b');
  a.group.put('theme:t', { id: 't' }); // items go through the sync folder, not this link
  assert.equal(a.sync.peers().length, 0);
  a.sync.join(b.sync.info());
  b.sync.join(a.sync.info());
  await a.sync.round();
  await b.sync.round();
  assert.equal(a.sync.peers()[0].url, 'https://b');
  assert.equal(b.sync.peers()[0].url, 'https://a');
  assert.equal(b.group.get('theme:t'), undefined);
});

test('join refuses bad host info, itself, and a known host with another key', async () => {
  const { a, b, c } = hosts('a', 'b', 'c');
  const info = b.sync.info();
  assert.throws(() => a.sync.join({ ...info, url: 'ftp://b' }), { status: 400 });
  assert.throws(() => a.sync.join({ ...info, publicKey: { ...info.publicKey, crv: 'P-384' } }), { status: 400 });
  assert.throws(() => a.sync.join({ ...info, publicKey: { ...info.publicKey, d: 'x' } }), { status: 400 });
  assert.throws(() => a.sync.join(a.sync.info()), { status: 409 });
  a.sync.join(info);
  assert.throws(() => a.sync.join({ ...info, publicKey: c.sync.info().publicKey }), { status: 409 });
});

test('join refuses a revoked host', async () => {
  const { a, b } = await pair();
  a.group.remove(`device:${b.group.hostId}`);
  assert.throws(() => a.sync.join(b.sync.info()), { status: 409 });
  assert.ok(a.group.get(`device:${b.group.hostId}`)!.deleted);
});

test('a host nonce relayed from another host is refused', async () => {
  const { a, b } = await pair();
  const { challengeMessage } = await import('../../shared/api.ts');
  const { sign, createPrivateKey } = await import('node:crypto');
  const { nonce, hostId } = a.sync.handle('challenge', { hostId: b.group.hostId }) as { nonce: string; hostId: string };
  assert.equal(hostId, a.group.hostId);
  const key = createPrivateKey(b.group.meta('hostKey')!);
  const signed = (id: string) =>
    sign('sha256', Buffer.from(challengeMessage(id, nonce)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  // b signed for another host (as if the nonce came from there): a refuses it.
  assert.throws(
    () => a.sync.handle('session', { hostId: b.group.hostId, nonce, signature: signed('other-host') }),
    /bad signature/,
  );
  const { nonce: again } = a.sync.handle('challenge', { hostId: b.group.hostId }) as { nonce: string };
  const ok = sign('sha256', Buffer.from(challengeMessage(a.group.hostId, again)), { key, dsaEncoding: 'ieee-p1363' });
  assert.ok(a.sync.handle('session', { hostId: b.group.hostId, nonce: again, signature: ok.toString('base64url') }));
});

test('a later device item with another key for a known id is refused, a revoke is not undone', () => {
  const { a } = hosts('a');
  const body = (x: string) => ({ name: 'Pixel', kind: 'phone', publicKey: JSON.stringify({ kty: 'EC', x }) });
  a.group.put('device:d1', body('one'));
  const seen = a.group.get('device:d1')!.version;
  const swapped = { key: 'device:d1', body: body('two'), version: { ...seen, other: 5 }, deleted: false };
  assert.equal(a.group.merge(swapped), 'older');
  assert.equal((a.group.get('device:d1')!.body as { publicKey: string }).publicKey, body('one').publicKey);
  // Same key, new level: fine.
  assert.equal(
    a.group.merge({ ...swapped, body: { ...body('one'), level: 'view' }, version: { ...seen, other: 6 } }),
    'newer',
  );
  a.group.remove('device:d1');
  a.group.put('device:d1', body('one')); // a plain write does not bring it back
  assert.equal(a.group.get('device:d1')!.deleted, true);
  assert.equal(a.group.merge({ ...swapped, body: body('one'), version: { ...seen, other: 99 } }), 'older');
  assert.equal(a.group.get('device:d1')!.deleted, true);
});
