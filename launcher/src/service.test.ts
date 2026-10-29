import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { launchdPlist, service, systemdUnit, type ServiceOptions } from './service.ts';

const opts: ServiceOptions = {
  node: '/usr/bin/node',
  launcher: '/usr/lib/node_modules/shub/dist/shub.js',
  home: '/home/me/.local/share/shub',
  env: { PATH: '/usr/local/bin:/usr/bin', SHUB_PORT: '4790', OTHER: 'x' },
};

test('systemd unit runs the launcher and keeps tmux alive across restarts', () => {
  const unit = systemdUnit(opts);
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" "\/usr\/lib\/node_modules\/shub\/dist\/shub\.js" start$/m);
  assert.match(unit, /^KillMode=process$/m);
  assert.match(unit, /^Environment="SHUB_HOME=\/home\/me\/\.local\/share\/shub"$/m);
  assert.match(unit, /^Environment="SHUB_PORT=4790"$/m);
  assert.match(unit, /^Environment="PATH=\/usr\/local\/bin:\/usr\/bin"$/m);
  assert.doesNotMatch(unit, /OTHER/);
  assert.doesNotMatch(unit, /NODE_ENV/, 'sessions inherit it: npm ci there would skip dev dependencies');
});

test('launchd agent runs the launcher and abandons the process group', () => {
  const plist = launchdPlist({ ...opts, home: '/Users/me/a&b' });
  assert.match(
    plist,
    /<string>\/usr\/bin\/node<\/string>\s*<string>\/usr\/lib\/node_modules\/shub\/dist\/shub\.js<\/string>\s*<string>start<\/string>/,
  );
  assert.match(plist, /<key>AbandonProcessGroup<\/key><true\/>/);
  assert.match(plist, /<key>SHUB_HOME<\/key><string>\/Users\/me\/a&amp;b<\/string>/);
  assert.doesNotMatch(plist, /NODE_ENV/);
});

test('install and uninstall on Linux: our unit only, systemctl --user', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-service-'));
  const calls: string[] = [];
  const s = service(
    'linux',
    { XDG_CONFIG_HOME: root, XDG_DATA_HOME: join(root, '.local', 'share'), HOME: root },
    (cmd, args) => void calls.push([cmd, ...args].join(' ')),
  );
  assert.equal(s.file, join(root, 'systemd', 'user', 'shub.service'));
  assert.equal(s.active(opts.home), false, 'no unit, not a service');
  s.install(opts);
  assert.equal(readFileSync(s.file, 'utf8'), systemdUnit(opts));
  assert.deepEqual(calls, ['systemctl --user daemon-reload', 'systemctl --user enable --now shub.service']);
  assert.equal(s.active(opts.home), true);
  assert.equal(s.active('/somewhere/else'), false, 'a unit for another home does not count');
  calls.length = 0;
  s.uninstall();
  assert.ok(!existsSync(s.file));
  assert.deepEqual(calls, ['systemctl --user disable --now shub.service', 'systemctl --user daemon-reload']);

  // A hand-written unit (like deploy/shub.service) is never overwritten, removed or restarted.
  mkdirSync(dirname(s.file), { recursive: true });
  writeFileSync(s.file, `[Service]\nExecStart=node server/main.ts\nEnvironment="SHUB_HOME=${opts.home}"\n`);
  assert.throws(() => s.install(opts), /was not written by shub/);
  assert.throws(() => s.uninstall(), /was not written by shub/);
  assert.equal(s.active(opts.home), false);
  s.install(opts, true);
  assert.equal(readFileSync(s.file, 'utf8'), systemdUnit(opts));

  // A hand-written unit that runs the launcher is restarted after an update, for its own home only.
  writeFileSync(s.file, `[Service]\nExecStart=%h/.local/bin/shub start\nEnvironment="SHUB_HOME=${opts.home}"\n`);
  assert.equal(s.active(opts.home), true);
  assert.equal(s.active('/somewhere/else'), false);
  writeFileSync(s.file, '[Service]\nExecStart=%h/.local/bin/shub start\n');
  assert.equal(s.active(join(root, '.local', 'share', 'shub')), true, 'no SHUB_HOME: the default home');
  assert.equal(s.active(opts.home), false);
});

test('install on macOS: LaunchAgents plist, launchctl bootstrap', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-service-'));
  const calls: string[] = [];
  const s = service('darwin', { HOME: root }, (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args[0] === 'bootout') throw new Error('not loaded');
  });
  assert.equal(s.file, join(root, 'Library', 'LaunchAgents', 'com.github.christoph-teichmeister.shub.plist'));
  s.install(opts);
  const uid = process.getuid?.() ?? 0;
  assert.deepEqual(calls, [
    `launchctl bootout gui/${uid}/com.github.christoph-teichmeister.shub`,
    `launchctl bootstrap gui/${uid} ${s.file}`,
  ]);
  calls.length = 0;
  s.restart();
  assert.deepEqual(calls, [`launchctl kickstart -k gui/${uid}/com.github.christoph-teichmeister.shub`]);
});

test('refresh points our unit at a new node and launcher without touching the rest or restarting', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-service-'));
  const calls: string[] = [];
  const s = service(
    'linux',
    { XDG_CONFIG_HOME: root, HOME: root },
    (cmd, args) => void calls.push([cmd, ...args].join(' ')),
  );
  assert.equal(s.unitNode(), null, 'no unit');
  assert.equal(s.refresh(opts), false, 'no unit, nothing to rewrite');
  s.install(opts);
  assert.equal(s.unitNode(), '/usr/bin/node');
  calls.length = 0;
  assert.equal(s.refresh(opts), false, 'already current');
  assert.deepEqual(calls, []);
  const moved = { ...opts, node: '/new/bin/node', launcher: '/new/lib/shub.js', env: { PATH: '/elsewhere' } };
  assert.equal(s.refresh(moved), true);
  const unit = readFileSync(s.file, 'utf8');
  assert.match(unit, /^ExecStart="\/new\/bin\/node" "\/new\/lib\/shub\.js" start$/m);
  assert.match(unit, /^Environment="PATH=\/usr\/local\/bin:\/usr\/bin"$/m, 'the environment stays as installed');
  assert.equal(s.unitNode(), '/new/bin/node');
  assert.deepEqual(calls, ['systemctl --user daemon-reload'], 'reload only, no restart');
});

test('refresh leaves a unit that shub did not write alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-service-'));
  const s = service('linux', { XDG_CONFIG_HOME: root, HOME: root }, () => {});
  mkdirSync(dirname(s.file), { recursive: true });
  const own = '[Service]\nExecStart="/old/node" "/old/shub.js" start\n';
  writeFileSync(s.file, own);
  assert.equal(s.unitNode(), null);
  assert.equal(s.refresh(opts), false);
  assert.equal(readFileSync(s.file, 'utf8'), own);
});
