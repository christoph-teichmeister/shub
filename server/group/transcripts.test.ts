import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, SyncSettings } from '../../shared/api.ts';
import { encodeCwd } from '../sessions/old.ts';
import { claudeArgs } from '../sessions/launch.ts';
import { GroupStore } from './index.ts';
import { FolderSync } from './folder.ts';
import { Transcripts, claimSession, handovers, pump, remoteSessions, resumeGuard, takenOver } from './transcripts.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const MB = 1024 * 1024;

interface Host {
  group: GroupStore;
  folder: FolderSync;
  transcripts: Transcripts;
  settings: SyncSettings;
  root: string;
  path: string;
  sessions: Session[];
  /** the project's folder inside this host's claude dir */
  dir: string;
}

/** Two hosts with the same project id but their own folders, sharing one sync folder and nothing else. */
async function pair() {
  const shared = mkdtempSync(join(tmpdir(), 'shub-tr-shared-'));
  const all: Record<string, Host> = {};
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
    host.folder = new FolderSync(group, { folder: () => shared, sync: () => host.settings, onMerged: () => {} });
    host.transcripts = new Transcripts(group, {
      folder: () => shared,
      sync: () => host.settings,
      projects: () => [{ id: 'app', path }],
      sessions: () => host.sessions,
      hostName: name,
      root,
    });
    all[name] = host;
  }
  const { a, b } = all;
  /** `from` writes its items and transcripts to the folder, `to` reads them: what a sync tool in between does. */
  const ship = async (from: Host, to: Host) => {
    await from.transcripts.sync();
    from.folder.flush(true);
    to.folder.scan();
    await to.transcripts.sync();
  };
  return { a, b, shared, ship };
}

const session = (h: Host, status: string, extra: object = {}) =>
  ({
    kind: 'claude',
    claudeSessionId: ID,
    projectId: 'app',
    cwd: h.path,
    name: 'X',
    status,
    lastActivityAt: new Date().toISOString(),
    ...extra,
  }) as unknown as Session;

test('pump appends whole lines only, from where the copy ends', async () => {
  const base = mkdtempSync(join(tmpdir(), 'shub-pump-'));
  const [src, dst] = [join(base, 'src.jsonl'), join(base, 'x', 'dst.jsonl')];
  writeFileSync(src, '{"n":1}\n{"n":2');
  assert.equal(await pump(src, dst), 8);
  assert.equal(readFileSync(dst, 'utf8'), '{"n":1}\n');
  appendFileSync(src, '}\n');
  assert.equal(await pump(src, dst), 8);
  assert.equal(readFileSync(dst, 'utf8'), '{"n":1}\n{"n":2}\n');
  assert.equal(await pump(src, dst), 0); // nothing new
  assert.equal(await pump(join(base, 'missing'), dst), 0);
});

test('a conversation goes through the sync folder and grows incrementally', async () => {
  const { a, b, shared, ship } = await pair();
  const line = (n: number) => JSON.stringify({ type: 'user', cwd: b.path, n }) + '\n';
  writeFileSync(join(b.dir, `${ID}.jsonl`), line(1) + line(2));
  b.sessions = [session(b, 'working')];
  b.transcripts.publishSessions();
  await ship(b, a);
  // the copy is under a's own folder name, and its bytes are untouched (claude --resume needs no rewrite)
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), line(1) + line(2));
  assert.deepEqual(readdirSync(a.dir), [`${ID}.jsonl`]);
  assert.ok(existsSync(join(shared, 'transcripts', 'app', `${ID}.jsonl`)));
  appendFileSync(join(b.dir, `${ID}.jsonl`), line(3));
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), line(1) + line(2) + line(3));
});

test('with transcripts off on either side nothing moves', async () => {
  const { a, b, ship } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  b.sessions = [session(b, 'working')];
  b.transcripts.publishSessions();
  b.settings = { transcripts: false };
  await ship(b, a);
  assert.deepEqual(readdirSync(a.dir), []);
  b.settings = {};
  a.settings = { transcripts: false };
  await ship(b, a);
  assert.deepEqual(readdirSync(a.dir), []);
});

test('a conversation idle for more than a week stays out of the folder', async () => {
  const { a, b, shared, ship } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  b.sessions = [session(b, 'paused', { lastActivityAt: '2026-01-01T00:00:00.000Z' })];
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.ok(!existsSync(join(shared, 'transcripts')));
  assert.ok(remoteSessions(a.group).length === 1); // the list entry still syncs
});

test('a project folder missing on this host gets no copy', async () => {
  const { a, b, shared, ship } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  b.sessions = [session(b, 'working')];
  b.transcripts.publishSessions();
  await ship(b, a);
  rmSync(a.dir, { recursive: true });
  const tr = new Transcripts(a.group, {
    folder: () => shared,
    sync: () => ({}),
    projects: () => [{ id: 'other', path: join(a.path, 'gone') }],
    sessions: () => [],
    hostName: 'a',
    root: a.root,
  });
  await tr.sync();
  assert.ok(!existsSync(a.dir));
});

test('the session list syncs and shows every host marked with its own', async () => {
  const { a, b, ship } = await pair();
  b.sessions = [
    session(b, 'working', { cwd: join(b.path, 'sub'), name: 'Fix it', lastActivityAt: '2026-10-23T10:00:00.000Z' }),
    { kind: 'shell', claudeSessionId: null, projectId: 'app', cwd: b.path } as Session,
  ];
  b.transcripts.publishSessions();
  await ship(b, a);
  const [remote] = remoteSessions(a.group);
  assert.equal(remote.name, 'Fix it');
  assert.equal(remote.host, 'b');
  assert.equal(remote.rel, 'sub');
  assert.equal(remoteSessions(b.group).length, 0); // not "remote" on its own host
  // a session of the other host is never overwritten from here
  a.sessions = [session(a, 'working', { cwd: join(a.path, 'sub'), name: 'Mine' })];
  a.transcripts.publishSessions();
  assert.equal((a.group.get(`session:${ID}`)!.body as { name: string }).name, 'Fix it');
  // switched off: the list does not leave
  b.settings = { sessions: false };
  b.group.put(`session:${ID}`, { ...(b.group.get(`session:${ID}`)!.body as object), name: 'Renamed' });
  await ship(b, a);
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

test('the session item carries running and the transcript size, and a new line follows', async () => {
  const { a, b, ship } = await pair();
  const file = join(b.dir, `${ID}.jsonl`);
  writeFileSync(file, '{"n":1}\n');
  b.sessions = [session(b, 'working')];
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.deepEqual([remoteSessions(a.group)[0].running, remoteSessions(a.group)[0].size], [true, 8]);
  appendFileSync(file, '{"n":2}\n');
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.equal(remoteSessions(a.group)[0].size, 16);
  assert.equal(readFileSync(join(a.dir, `${ID}.jsonl`), 'utf8'), '{"n":1}\n{"n":2}\n');
});

test('resuming on another host is refused while the owner runs it or our copy is behind, unless taken over', async () => {
  const { a, b, ship } = await pair();
  writeFileSync(join(b.dir, `${ID}.jsonl`), '{"n":1}\n');
  const publish = (status: string) => {
    b.sessions = [session(b, status)];
    b.transcripts.publishSessions();
    b.folder.flush(true);
    a.folder.scan();
  };
  assert.equal(resumeGuard(a.group, ID, 0), undefined); // unknown session: nothing to guard
  publish('working');
  assert.match(resumeGuard(a.group, ID, 8)!, /running on b/);
  assert.equal(resumeGuard(a.group, ID, 8, true), undefined);
  publish('paused');
  assert.match(resumeGuard(a.group, ID, 3)!, /behind b \(3 of 8 bytes\)/);
  assert.equal(resumeGuard(a.group, ID, 8), undefined);
  // taking over moves the ownership: a's item now names a, and b's next publish does not take it back
  claimSession(a.group, ID, 'a');
  assert.equal(remoteSessions(a.group).length, 0);
  await ship(a, b);
  assert.equal(remoteSessions(b.group)[0]?.host, 'a');
});

test('a session that is gone from its owner is published as not running', async () => {
  const { a, b, ship } = await pair();
  b.sessions = [session(b, 'working')];
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.equal(remoteSessions(a.group)[0].running, true);
  b.sessions = [];
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.equal(remoteSessions(a.group)[0].running, false);
});

test('a session another host took over is reported to its old owner, paused or not-ours ones are not', async () => {
  const { a, b, ship } = await pair();
  const mine = session(b, 'working');
  b.sessions = [mine];
  b.transcripts.publishSessions();
  await ship(b, a);
  assert.deepEqual(takenOver(b.group, b.sessions), []); // still ours
  claimSession(a.group, ID, 'a');
  await ship(a, b);
  assert.deepEqual(takenOver(b.group, b.sessions), [mine]);
  assert.deepEqual(takenOver(b.group, [{ ...mine, status: 'paused' }]), []);
});

test('a shutdown releases the open conversations; the other host gets them whole and may pick them up', async () => {
  const { a, b, ship } = await pair();
  const line = JSON.stringify({ type: 'user', n: 1 }) + '\n';
  writeFileSync(join(b.dir, `${ID}.jsonl`), line);
  b.sessions = [session(b, 'your-turn')];
  b.transcripts.publishSessions();
  await ship(b, a);
  // while it runs, nothing is up for pick-up
  const projects = [{ id: 'app', path: a.path }];
  const size = (p: string, id: string) => a.transcripts.localSize(p, id);
  assert.deepEqual(handovers(a.group, projects, size), []);
  assert.equal(await b.transcripts.release(), true);
  await ship(b, a);
  const [h] = handovers(a.group, projects, size);
  assert.equal(h.claudeSessionId, ID);
  assert.equal(h.cwd, a.path);
  assert.equal(h.running, false);
  // and the resume guard lets it through, as the copy is whole
  assert.equal(resumeGuard(a.group, ID, size(a.path, ID)), undefined);
  // a copy that is behind is not picked up
  assert.deepEqual(
    handovers(a.group, projects, () => 0),
    [],
  );
});
