import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture, type FixtureRelease } from '../test/fixture.ts';
import { archiveName, source } from './releases.ts';
import { channelFor, check, healthCheck, rollback, update, type Deps } from './update.ts';
import { currentVersion, installedVersions, readState } from './versions.ts';

const RELEASES: FixtureRelease[] = [
  { version: '2026.10.0' },
  { version: '2026.10.1', notes: 'feat: faster' },
  { version: '2026.11.0-beta.1', prerelease: true, notes: 'feat: shiny' },
];

function setup(opts: { service?: boolean; healthy?: boolean | ((v: string) => boolean) } = {}) {
  const f = makeFixture(RELEASES);
  const home = mkdtempSync(join(tmpdir(), 'shub-update-'));
  const calls: string[] = [];
  const healthy = opts.healthy ?? true;
  const deps: Deps = {
    home,
    source: source({ SHUB_TEST_RELEASES: f.url }),
    service: { active: () => opts.service ?? false, restart: () => void calls.push(`restart ${currentVersion(home)}`) },
    health: async (v) => (typeof healthy === 'function' ? healthy(v) : healthy),
    log: () => {},
    healthTimeoutMs: 50,
  };
  return { f, home, calls, deps };
}

test('channel: the flag, else the setting, else the kind of version that runs', () => {
  assert.equal(channelFor('beta', 'stable', null), 'beta');
  assert.equal(channelFor(undefined, 'beta', '2026.10.0'), 'beta');
  assert.equal(channelFor(undefined, undefined, '2026.11.0-beta.1'), 'beta');
  assert.equal(channelFor(undefined, undefined, '2026.10.0'), 'stable');
  assert.throws(() => channelFor('nightly', undefined, null), /unknown channel/);
});

test('first install takes the newest stable release; not a service, so nothing restarts', async () => {
  const { home, calls, deps } = setup();
  const result = await update(deps, { channel: 'stable' });
  assert.equal(result?.message, 'Installed 2026.10.1.');
  assert.equal(currentVersion(home), '2026.10.1');
  assert.equal(readFileSync(join(home, 'current', 'package.json'), 'utf8'), '{"version":"2026.10.1"}');
  assert.deepEqual(calls, []);
  assert.deepEqual(readdirSync(join(home, 'versions')), ['2026.10.1'], 'no partial folders left');
  assert.deepEqual(readdirSync(join(home, 'downloads')), [], 'downloads cleaned up');
  assert.equal(await update(deps, { channel: 'stable' }), null, 'already up to date');
});

test('check: newer version and changelog per channel', async () => {
  const { deps } = setup();
  await update(deps, { to: '2026.10.0', channel: 'stable' });
  assert.deepEqual(await check(deps, 'stable'), {
    current: '2026.10.0',
    channel: 'stable',
    latest: '2026.10.1',
    changelog: '## 2026.10.1\n\nfeat: faster',
  });
  const beta = await check(deps, 'beta');
  assert.equal(beta.latest, '2026.11.0-beta.1');
  assert.match(beta.changelog!, /## 2026\.11\.0-beta\.1\n\nfeat: shiny\n\n## 2026\.10\.1/);
});

test('update as a service: switch, restart, healthy; rollback switches back', async () => {
  const { home, calls, deps } = setup({ service: true });
  await update(deps, { to: '2026.10.0', channel: 'stable' });
  const result = await update(deps, { channel: 'stable' });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, 'Updated to 2026.10.1.');
  assert.equal(currentVersion(home), '2026.10.1');
  assert.equal(readState(home).previous, '2026.10.0');
  assert.deepEqual(calls, ['restart 2026.10.0', 'restart 2026.10.1']);

  const back = await rollback(deps);
  assert.equal(back.message, 'Rolled back to 2026.10.0.');
  assert.equal(currentVersion(home), '2026.10.0');
  assert.equal(readState(home).previous, '2026.10.1');
});

test('a version that does not answer /api/health is rolled back and the reason recorded', async () => {
  // Fake server that keeps answering as the old version, like a new version that never came up.
  const server = createServer((_req, res) => res.end(JSON.stringify({ ok: true, version: '2026.10.0' })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const health = healthCheck((server.address() as { port: number }).port);
  const { home, calls, deps } = setup({ service: true });
  deps.health = health;
  deps.healthTimeoutMs = 1200;
  await update(deps, { to: '2026.10.0', channel: 'stable' });
  calls.length = 0;
  const result = await update(deps, { channel: 'stable' });
  server.close();
  assert.equal(result?.ok, false);
  assert.equal(result?.message, '2026.10.1 did not answer /api/health within 1 s; rolled back to 2026.10.0.');
  assert.equal(currentVersion(home), '2026.10.0');
  assert.deepEqual(calls, ['restart 2026.10.1', 'restart 2026.10.0']);
  assert.deepEqual(readState(home).last, { ...result });
  assert.equal(readState(home).previous, undefined, 'the broken version is not offered as "previous"');
});

test('a healthy fake server lets the update through', async () => {
  const server = createServer((_req, res) => res.end(JSON.stringify({ ok: true, version: '2026.10.1' })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { home, deps } = setup({ service: true });
  deps.health = healthCheck((server.address() as { port: number }).port);
  const result = await update(deps, { to: '2026.10.1', channel: 'stable' });
  server.close();
  assert.equal(result?.ok, true);
  assert.equal(currentVersion(home), '2026.10.1');
});

test('a tampered archive is never installed', async () => {
  const { f, home, deps } = setup();
  await update(deps, { to: '2026.10.0', channel: 'stable' });
  appendFileSync(join(f.dir, '2026.10.1', archiveName('2026.10.1')), 'evil');
  await assert.rejects(update(deps, { channel: 'stable' }), /does not match its SHA256SUMS entry/);
  assert.equal(currentVersion(home), '2026.10.0');
  assert.deepEqual(installedVersions(home), ['2026.10.0']);
  assert.ok(!existsSync(join(home, 'update.lock')), 'lock released');
  await assert.rejects(update(deps, { to: '../../etc', channel: 'stable' }), /not a version/);
  await assert.rejects(update(deps, { to: '2027.1.0', channel: 'stable' }), /there is no release 2027\.1\.0/);
  await assert.rejects(rollback(setup().deps), /no previous version/);
  const empty = setup();
  empty.deps.source = { ...empty.deps.source, releases: async () => [] };
  await assert.rejects(update(empty.deps, { channel: 'stable' }), /there is no stable release yet/);
});
