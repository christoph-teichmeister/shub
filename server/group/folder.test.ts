import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SyncSettings } from '../../shared/api.ts';
import { FolderSync } from './folder.ts';
import { GroupStore } from './index.ts';

interface Host {
  group: GroupStore;
  folder: FolderSync;
  settings: SyncSettings;
  merged: number;
}

/** Machines that share one folder, the way a sync tool leaves them: no network, no other machine needs to be on. */
function machines(...names: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'shub-folder-'));
  const all: Record<string, Host> = {};
  for (const name of names) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE migrations (module TEXT NOT NULL, step INTEGER NOT NULL, PRIMARY KEY (module, step))');
    const group = new GroupStore(db, (_m, statements) => statements.forEach((s) => db.exec(s)));
    const host = { group, settings: {}, merged: 0 } as Host;
    host.folder = new FolderSync(group, {
      folder: () => dir,
      sync: () => host.settings,
      onMerged: () => host.merged++,
    });
    all[name] = host;
  }
  return { dir, ...all } as { dir: string } & Record<'a' | 'b', Host>;
}

test('a change reaches a machine that was off when it was made', () => {
  const { a, b } = machines('a', 'b');
  a.group.put('theme:t', { id: 't' });
  a.folder.flush(); // a writes, then it is gone
  b.folder.scan(); // b starts later and finds it
  assert.deepEqual(b.group.get('theme:t')?.body, { id: 't' });
  assert.equal(b.merged, 1);
  b.folder.scan(); // nothing new: nothing merged again
  assert.equal(b.merged, 1);
});

test('a first scan writes what the folder lacks, and a deletion travels as a tombstone', () => {
  const { a, b } = machines('a', 'b');
  a.group.put('project:p', { id: 'p' });
  a.folder.scan();
  b.folder.scan();
  assert.ok(b.group.get('project:p'));
  a.group.remove('project:p');
  a.folder.flush();
  b.folder.scan();
  assert.equal(b.group.get('project:p')?.deleted, true);
});

test('a change on both machines while apart is a conflict, not a lost edit', () => {
  const { a, b } = machines('a', 'b');
  a.group.put('theme:t', { id: 't', v: 'a' });
  b.group.put('theme:t', { id: 't', v: 'b' });
  a.folder.flush();
  b.folder.flush(); // the folder holds b's version now
  a.folder.scan();
  assert.equal(a.group.conflicts().length, 1);
  assert.deepEqual(a.group.get('theme:t')?.body, { id: 't', v: 'a' });
});

test('a switched-off category neither leaves nor enters; plugin env stays home', () => {
  const { a, b } = machines('a', 'b');
  a.settings = { themes: false };
  a.group.put('theme:t', { id: 't' });
  a.group.put('plugin:p', { name: 'p', env: { KEY: 'secret' } });
  a.folder.flush();
  b.folder.scan();
  assert.equal(b.group.get('theme:t'), undefined);
  assert.deepEqual(b.group.get('plugin:p')?.body, { name: 'p' });
  b.settings = { projects: false };
  b.group.put('project:x', { id: 'x' });
  a.group.merge(b.group.get('project:x')!);
  a.folder.flush(true);
  b.folder.scan();
  assert.equal(b.group.conflicts().length, 0);
});

test('devices never go through the folder, and junk files are ignored', () => {
  const { dir, a, b } = machines('a', 'b');
  a.group.put('device:d', { name: 'laptop', kind: 'browser', publicKey: {} });
  a.group.put('theme:t', { id: 't' });
  a.folder.flush(true);
  assert.deepEqual(readdirSync(join(dir, 'items')), ['theme%3At.json']);
  // a leaked folder must not admit a device even when someone writes the file by hand
  writeFileSync(
    join(dir, 'items', 'device%3Aevil.json'),
    JSON.stringify({ key: 'device:evil', body: {}, version: { x: 1 }, deleted: false }),
  );
  writeFileSync(join(dir, 'items', 'half.json'), '{"key": "theme:x", ');
  writeFileSync(
    join(dir, 'items', 'bad.json'),
    JSON.stringify({ key: 'theme:y', version: { x: 'no' }, deleted: false }),
  );
  b.folder.scan();
  assert.equal(b.group.get('device:evil'), undefined);
  assert.equal(b.group.get('device:d'), undefined);
  assert.ok(b.group.get('theme:t'));
  assert.equal(b.group.get('theme:y'), undefined);
});

test('a copy the sync tool set aside is merged by its version and removed', () => {
  const { dir, a, b } = machines('a', 'b');
  a.group.put('theme:t', { id: 't', v: 1 });
  a.folder.flush();
  b.folder.scan();
  a.group.put('theme:t', { id: 't', v: 2 });
  const newer = JSON.stringify(a.group.get('theme:t'));
  writeFileSync(join(dir, 'items', 'theme%3At.sync-conflict-20261115-080000-ABCDEFG.json'), newer);
  b.folder.scan();
  assert.deepEqual(b.group.get('theme:t')?.body, { id: 't', v: 2 });
  assert.ok(!readdirSync(join(dir, 'items')).some((n) => n.includes('.sync-conflict-')));
});

test('no folder set: nothing is written or read', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE migrations (module TEXT NOT NULL, step INTEGER NOT NULL, PRIMARY KEY (module, step))');
  const group = new GroupStore(db, (_m, statements) => statements.forEach((s) => db.exec(s)));
  const folder = new FolderSync(group, { folder: () => undefined, sync: () => ({}), onMerged: () => assert.fail() });
  group.put('theme:t', { id: 't' });
  folder.flush();
  folder.scan();
  assert.equal(folder.status().folder, undefined);
  mkdirSync(tmpdir(), { recursive: true });
});
