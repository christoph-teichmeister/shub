import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { makeFixture } from '../test/fixture.ts';

const run = promisify(execFile);
const cli = new URL('./shub.ts', import.meta.url).pathname;
const launcherVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('install, start, pass through to the app CLI, check for updates', async () => {
  const f = makeFixture([{ version: '2026.10.0' }, { version: '2026.10.1-beta.1', prerelease: true }]);
  const root = mkdtempSync(join(tmpdir(), 'shub-cli-'));
  const env = {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'config'),
    SHUB_CONFIG_DIR: join(root, 'config', 'shub'),
    SHUB_HOME: join(root, 'home'),
    SHUB_STATE_DIR: join(root, 'state'),
    SHUB_TEST_RELEASES: f.url,
    SHUB_PORT: '4999',
  };
  const shub = (...args: string[]) => run(process.execPath, ['--no-warnings', cli, ...args], { env });

  assert.equal((await shub('--version')).stdout, `launcher ${launcherVersion}\napp not installed (shub install)\n`);
  await assert.rejects(shub('status'), /shub is not installed yet\. Run: shub install/);
  assert.match((await shub('install')).stdout, /Installed 2026\.10\.0\.\nNext: shub service install/);
  assert.match((await shub('install', '--yes')).stdout, /shub 2026\.10\.0 is installed/);

  await assert.rejects(shub('token'), /no access token yet/);
  mkdirSync(env.SHUB_STATE_DIR);
  writeFileSync(join(env.SHUB_STATE_DIR, 'token'), 'abc123\n');
  assert.equal((await shub('token')).stdout, 'abc123\n');

  const started = (await shub()).stdout;
  assert.equal(
    started,
    `fake server {"version":"2026.10.0","launcher":true,"home":${JSON.stringify(env.SHUB_HOME)}}\n`,
  );
  assert.equal(JSON.parse(readFileSync(join(env.SHUB_HOME, 'launcher.json'), 'utf8')).port, 4999);

  assert.deepEqual(JSON.parse((await shub('status', '--json')).stdout), { cli: ['status', '--json'], launcher: true });

  assert.deepEqual(JSON.parse((await shub('update', '--check', '--json')).stdout), {
    current: '2026.10.0',
    channel: 'stable',
  });
  const beta = JSON.parse((await shub('update', '--check', '--json', '--channel', 'beta')).stdout);
  assert.equal(beta.latest, '2026.10.1-beta.1');
  await assert.rejects(shub('update', '--channel', 'nightly'), /unknown channel "nightly"/);
  await assert.rejects(shub('rollback', 'now'), /unexpected argument "now"/);
  assert.match((await shub('--help')).stdout, /^shub — your session hub \(launcher /);
});
