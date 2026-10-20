import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Finding } from './doctor.ts';
import { setup, writeChannelTo, type SetupDeps } from './setup.ts';

const ok: Finding[] = [
  { name: 'Node', ok: true, detail: 'Node 24.2.0' },
  { name: 'tmux', ok: true, detail: 'tmux 3.6' },
  { name: 'Claude Code', ok: true, detail: '/usr/bin/claude' },
];

/** Answers the questions in order and records what the wizard did. */
function fake(answers: string[], over: Partial<SetupDeps> = {}) {
  const out: string[] = [];
  const did: string[] = [];
  const deps: SetupDeps = {
    ask: async (q) => {
      out.push(q);
      const a = answers.shift();
      if (a === undefined) throw new Error(`unexpected question: ${q}`);
      return a;
    },
    log: (l) => out.push(l),
    platform: 'linux',
    doctor: async () => ok,
    portState: async () => 'free',
    configuredChannel: undefined,
    writeChannel: (c) => void did.push(`channel ${c}`),
    installed: () => null,
    install: async (c) => (did.push(`install ${c}`), '2026.10.1'),
    installService: (env) => (did.push(`service ${JSON.stringify(env)}`), 'Installed shub.service and started it.'),
    health: async () => true,
    token: () => 'abc123',
    tokenFile: '/state/token',
    copy: () => (did.push('copy'), true),
    open: (url) => void did.push(`open ${url}`),
    ...over,
  };
  return { deps, did, text: () => stripVTControlCharacters(out.join('\n')), left: answers };
}

test('defaults all the way: stable, 4780, service, token, browser', async () => {
  const f = fake(['', '', '', '', '']);
  assert.equal(await setup(f.deps), true);
  assert.deepEqual(f.did, ['channel stable', 'install stable', 'service {}', 'copy', 'open http://127.0.0.1:4780']);
  assert.match(f.text(), /\[1\/6\] Check this machine[\s\S]*\[6\/6\] Log in/);
  assert.match(f.text(), /│ abc123 │/);
  assert.match(f.text(), /Copied to the clipboard/);
});

test('missing tmux: shows the install command and checks again until it is there', async () => {
  let checks = 0;
  const f = fake(['', '', '', '', '', '', 'n'], {
    doctor: async () =>
      ++checks === 1 ? [ok[0], { name: 'tmux', ok: false, detail: 'tmux is not installed' }, ok[2]] : ok,
  });
  assert.equal(await setup(f.deps), true);
  assert.equal(checks, 2);
  assert.match(f.text(), /✗ tmux\s+tmux is not installed/);
  assert.match(f.text(), /sudo apt install tmux/);
});

test('q at the check quits before anything is changed', async () => {
  const f = fake(['q'], { doctor: async () => [{ name: 'tmux', ok: false, detail: 'missing' }] });
  assert.equal(await setup(f.deps), false);
  assert.deepEqual(f.did, []);
});

test('beta, busy port, public URL, no service', async () => {
  const f = fake(['nightly', 'beta', '80', '4780', '4781', 'http://x', 'https://pc.tail.ts.net/', 'n'], {
    portState: async (p) => (p === 4780 ? 'busy' : 'free'),
    token: () => null,
  });
  assert.equal(await setup(f.deps), true);
  assert.deepEqual(f.did, ['channel beta', 'install beta']);
  assert.match(f.text(), /"nightly" is not a channel/);
  assert.match(f.text(), /1024 to 65535/);
  assert.match(f.text(), /4780 is used by another program/);
  assert.match(f.text(), /starts with https:\/\//);
  assert.match(f.text(), /SHUB_PORT=4781 shub start/);
  assert.match(f.text(), /Then: shub token/);
});

test('service gets port and public URL; a foreign unit is replaced only when asked', async () => {
  let tries = 0;
  const f = fake(['', '4781', 'https://pc.tail.ts.net', '', 'y', 'n'], {
    installed: () => '2026.10.0',
    installService: (env, force) => {
      if (++tries === 1) throw new Error('shub.service exists and was not written by shub');
      return `force=${force} ${JSON.stringify(env)}`;
    },
  });
  assert.equal(await setup(f.deps), true);
  assert.match(f.text(), /shub 2026\.10\.0 is already installed/);
  assert.match(f.text(), /force=true \{"SHUB_PORT":"4781","SHUB_PUBLIC_URL":"https:\/\/pc\.tail\.ts\.net"\}/);
  assert.deepEqual(f.left, []);
});

test('the channel goes into local.json and keeps its other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shub-setup-'));
  writeChannelTo(dir, 'beta');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'local.json'), 'utf8')), { updateChannel: 'beta' });
  writeFileSync(join(dir, 'local.json'), JSON.stringify({ defaultPermissionMode: 'default', updateChannel: 'beta' }));
  writeChannelTo(dir, 'stable');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'local.json'), 'utf8')), {
    defaultPermissionMode: 'default',
    updateChannel: 'stable',
  });
});
