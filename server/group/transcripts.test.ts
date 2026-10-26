import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, SyncSettings } from '../../shared/api.ts';
import { encodeCwd } from '../sessions/old.ts';
import { claudeArgs } from '../sessions/launch.ts';
import { GroupStore } from './index.ts';
import { HostSync } from './sync.ts';
import { Transcripts, claimSession, remoteSessions, resumeGuard } from './transcripts.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const MB = 1024 * 1024;

interface Host {
  group: GroupStore;
  sync: HostSync;
  transcripts: Transcripts;
  settings: SyncSettings;
  root: string;
  path: string;
  sessions: Session[];
  /** the project's folder inside this host's claude dir */
  dir: string;
}

/** Two hosts with the same project id but their own folders, reaching each other through a fake network. */
async function pair() {
  const drop = { after: Infinity };
  const all: Record<string, Host> = {};
  let chunks = 0;
  const net = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const action = u.pathname.split('/').pop() as never;
    if (action === 'chunk' && ++chunks > drop.after) throw new TypeError('fetch failed');
    const token = /^Bearer (.+)$/.exec((init.headers as Record<string, string>).authorization ?? '')?.[1];
    try {
      const body = await all[u.hostname].sync.handle(action, JSON.parse(init.body as string), token);
      return new Response(JSON.stringify(body), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: (err as { status: number }).status,
      });
    }
  }) as typeof fetch;
  for (const name of ['a', 'b']) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE migrations (module TEXT NOT NULL, step INTEGER NOT NULL, PRIMARY KEY (module, step))');
    const group = new GroupStore(db, (_m, statements) => statements.forEach((s) => db.exec(s)));
    const base = mkdtempSync(join(tmpdir(), `shub-tr-${name}-`));
    const path = join(base, 'work', 'app');
    mkdirSync(path, { recursive: true });
    const root = join(base, 'claude');
    const dir = join(root, 'projects', encodeCwd(path));
    mkdirSync(dir, { recursive: true });
    const host = { group, settings: {}, root, path, dir, sessions: [] } as unknown as Host;
    host.sync = new HostSync(group, {
      sync: () => host.settings,
      url: () => `https://${name}`,
      onMerged: () => {},
      serve: (action, body) => host.transcripts.serve(action, body),
      fetch: net,
      name,
    });
    host.transcripts = new Transcripts(group, host.sync, {
      sync: () => host.settings,
      projects: () => [{ id: 'app', path }],
      sessions: () => host.sessions,
      hostName: name,
      root,
    });
    host.sync.announce();
    all[name] = host;
  }
  const { a, b } = all;
  a.group.merge(b.group.get(`device:${b.group.hostId}`)!);
  b.group.merge(a.group.get(`device:${a.group.hostId}`)!);
  return { a, b, drop, chunks: () => chunks };
}

test('a transcript lands in the folder of this host and grows incrementally', async () => {
  const { a, b, chunks } = await pair();
  const line = (n: number) => JSON.stringify({ type: 'user', cwd: b.path, n }) + '\n';
  writeFileSync(join(b.dir, `${ID}.jsonl`), line(1) + line(2));
  await a.transcripts.run();
  // the copy is under a's own folder name, and its bytes are untouched (claude --resume needs no rewrite)
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), line(1) + line(2));
  assert.deepEqual(readdirSync(a.dir), [`${ID}.jsonl`]);
  const first = chunks();
  await a.transcripts.run(); // nothing new: nothing fetched
  assert.equal(chunks(), first);
  appendFileSync(join(b.dir, `${ID}.jsonl`), line(3));
  await a.transcripts.run();
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), line(1) + line(2) + line(3));
  assert.equal((await a.transcripts.progress()).running, false);
});

test('an interrupted copy resumes from what arrived, and the plain file only appears whole', async () => {
  const { a, b, drop, chunks } = await pair();
  const lines = Array.from({ length: 60 }, (_, n) => JSON.stringify({ n, pad: 'x'.repeat(100_000) }) + '\n').join('');
  assert.ok(lines.length > 5 * MB);
  writeFileSync(join(b.dir, `${ID}.jsonl`), lines);
  drop.after = 1; // the network drops after the first chunk
  await a.transcripts.run();
  assert.ok(!existsSync(join(a.dir, `${ID}.jsonl`)));
  assert.equal(statSync(join(a.dir, `${ID}.jsonl.part`)).size, 4 * MB);
  drop.after = Infinity;
  const before = chunks();
  await a.transcripts.run();
  assert.equal(chunks() - before, 1); // only the rest was fetched
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), lines);
  assert.deepEqual(readdirSync(a.dir), [`${ID}.jsonl`]);
});

test('a transcript still being written is copied up to its last whole line', async () => {
  const { a, b } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n{"n":2');
  await a.transcripts.run();
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), '{"n":1}\n');
  appendFileSync(join(b.dir, `${ID}.jsonl`), '}\n');
  await a.transcripts.run();
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), '{"n":1}\n{"n":2}\n');
});

test('with transcripts off on either side nothing moves', async () => {
  const { a, b } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  b.settings = { transcripts: false };
  await a.transcripts.run();
  assert.deepEqual(readdirSync(a.dir), []);
  b.settings = {};
  a.settings = { transcripts: false };
  await a.transcripts.run();
  assert.deepEqual(readdirSync(a.dir), []);
});

test('a project folder missing on this host gets no copy', async () => {
  const { a, b } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  const tr = new Transcripts(a.group, a.sync, {
    sync: () => ({}),
    projects: () => [{ id: 'app', path: join(a.path, 'gone') }],
    sessions: () => [],
    hostName: 'a',
    root: a.root,
  });
  await tr.run();
  assert.deepEqual(readdirSync(a.dir), []);
});

test('the session list syncs and shows every host marked with its own', async () => {
  const { a, b } = await pair();
  b.sessions = [
    {
      kind: 'claude',
      claudeSessionId: ID,
      projectId: 'app',
      cwd: join(b.path, 'sub'),
      name: 'Fix it',
      lastActivityAt: '2026-10-23T10:00:00.000Z',
    } as Session,
    { kind: 'shell', claudeSessionId: null, projectId: 'app', cwd: b.path } as Session,
  ];
  b.transcripts.publishSessions();
  await b.sync.flush();
  const [remote] = remoteSessions(a.group);
  assert.equal(remote.name, 'Fix it');
  assert.equal(remote.host, 'b');
  assert.equal(remote.rel, 'sub');
  assert.equal(remoteSessions(b.group).length, 0); // not "remote" on its own host
  // a session of the other host is never overwritten from here
  a.sessions = [{ ...b.sessions[0], name: 'Mine' } as Session];
  a.transcripts.publishSessions();
  assert.equal((a.group.get(`session:${ID}`)!.body as { name: string }).name, 'Fix it');
  // switched off: the list does not leave
  b.settings = { sessions: false };
  b.transcripts.publishSessions();
  b.group.put(`session:${ID}`, { ...(b.group.get(`session:${ID}`)!.body as object), name: 'Renamed' });
  await b.sync.flush();
  assert.equal(remoteSessions(a.group)[0].name, 'Fix it');
});

test('resuming a session of another host forks: the original stays', () => {
  const spec = {
    kind: 'claude',
    claudeSessionId: ID,
    settingsFile: 's',
    permissionMode: 'default',
    resume: true,
  } as const;
  assert.ok(claudeArgs({ ...spec, fork: true }).includes('--fork-session'));
  assert.ok(!claudeArgs(spec).includes('--fork-session'));
});

test('the session item carries running and the transcript size, and a push brings the new bytes', async () => {
  const { a, b, chunks } = await pair();
  const file = join(b.dir, `${ID}.jsonl`);
  writeFileSync(file, '{"n":1}\n');
  b.sessions = [
    { kind: 'claude', claudeSessionId: ID, projectId: 'app', cwd: b.path, name: 'X', status: 'working' } as Session,
  ];
  b.transcripts.publishSessions();
  await b.sync.flush();
  assert.deepEqual([remoteSessions(a.group)[0].running, remoteSessions(a.group)[0].size], [true, 8]);
  await a.transcripts.run();
  const first = chunks();
  appendFileSync(file, '{"n":2}\n');
  b.transcripts.publishSessions();
  await b.sync.flush();
  assert.equal(remoteSessions(a.group)[0].size, 16);
  await a.transcripts.run();
  assert.equal(chunks() - first, 1); // one chunk from offset 8, no full recopy
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), '{"n":1}\n{"n":2}\n');
});

test('resuming on another host is refused while the owner runs it or our copy is behind, unless taken over', async () => {
  const { a, b } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  const publish = (status: string) => {
    b.sessions = [{ kind: 'claude', claudeSessionId: ID, projectId: 'app', cwd: b.path, name: 'X', status } as Session];
    b.transcripts.publishSessions();
    return b.sync.flush();
  };
  assert.equal(resumeGuard(a.group, ID, 0), undefined); // unknown session: nothing to guard
  await publish('working');
  assert.match(resumeGuard(a.group, ID, 8)!, /running on b/);
  assert.equal(resumeGuard(a.group, ID, 8, true), undefined);
  await publish('paused');
  assert.match(resumeGuard(a.group, ID, 3)!, /behind b \(3 of 8 bytes\)/);
  assert.equal(resumeGuard(a.group, ID, 8), undefined);
  // taking over moves the ownership: a's item now names a, and b's next publish does not take it back
  claimSession(a.group, ID, 'a');
  assert.equal(remoteSessions(a.group).length, 0);
  await a.sync.flush();
  assert.equal(remoteSessions(b.group)[0]?.host, 'a');
});
