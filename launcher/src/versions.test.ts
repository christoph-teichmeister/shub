import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  currentVersion,
  installedVersions,
  lock,
  prune,
  readState,
  shubHome,
  switchTo,
  versionDir,
  writeState,
} from './versions.ts';

function home(versions: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'shub-home-'));
  for (const v of versions) mkdirSync(versionDir(dir, v), { recursive: true });
  return dir;
}

test('home: SHUB_HOME, else XDG_DATA_HOME/shub, else ~/.local/share/shub', () => {
  assert.equal(shubHome({ SHUB_HOME: '/x' }), '/x');
  assert.equal(shubHome({ XDG_DATA_HOME: '/data' }), '/data/shub');
  assert.match(shubHome({}), /\/\.local\/share\/shub$/);
});

test('switching rewrites the current link in one rename', () => {
  const h = home(['2026.10.0', '2026.10.1']);
  assert.equal(currentVersion(h), null);
  switchTo(h, '2026.10.0');
  switchTo(h, '2026.10.1');
  assert.ok(lstatSync(join(h, 'current')).isSymbolicLink());
  assert.equal(readlinkSync(join(h, 'current')), join('versions', '2026.10.1'));
  assert.equal(currentVersion(h), '2026.10.1');
  assert.deepEqual(readdirSync(h).sort(), ['current', 'versions'], 'no temporary link left behind');
  assert.throws(() => switchTo(h, '2026.11.0'), /not installed/);
  assert.equal(currentVersion(h), '2026.10.1');
});

test('pruning keeps only current and previous', () => {
  const h = home(['2026.9.0', '2026.9.1', '2026.10.0', '2026.10.1', '2026.10.2', 'not-a-version']);
  switchTo(h, '2026.10.2');
  writeState(h, { previous: '2026.10.1' });
  assert.deepEqual(prune(h), ['2026.10.0', '2026.9.1', '2026.9.0']);
  assert.deepEqual(installedVersions(h), ['2026.10.2', '2026.10.1']);

  // After switching back to an old version, the previous one is kept even though it is not among the newest.
  const g = home(['2026.9.0', '2026.10.0', '2026.10.1', '2026.10.2']);
  switchTo(g, '2026.10.2');
  writeState(g, { previous: '2026.9.0' });
  assert.deepEqual(prune(g), ['2026.10.1', '2026.10.0']);
  assert.deepEqual(installedVersions(g), ['2026.10.2', '2026.9.0']);
});

test('state is merged and written atomically', () => {
  const h = home([]);
  assert.deepEqual(readState(h), {});
  writeState(h, { previous: '2026.10.0', port: 4780 });
  writeState(h, { previous: undefined });
  assert.deepEqual(readState(h), { port: 4780 });
});

test('one update at a time; a stale lock is taken over', async () => {
  const h = home([]);
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
  await new Promise((r) => other.once('spawn', r));
  writeFileSync(join(h, 'update.lock'), String(other.pid));
  assert.throws(() => lock(h), new RegExp(`another update is running \\(pid ${other.pid}\\)`));
  other.kill();
  await new Promise((r) => other.once('exit', r));
  const unlock = lock(h);
  unlock();
  lock(h)();
});
