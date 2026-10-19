import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doctor, type DoctorDeps } from './doctor.ts';

const healthy: DoctorDeps = {
  nodeVersion: '24.2.0',
  tmuxVersion: () => 'tmux 3.3a',
  which: (c) => `/usr/local/bin/${c}`,
  exists: () => true,
  dockerSocket: '/var/run/docker.sock',
  port: 4780,
  portState: async () => 'free',
};

const failing = async (d: Partial<DoctorDeps>) =>
  (await doctor({ ...healthy, ...d }))
    .filter((f) => !f.ok)
    .map((f) => `${f.name}${f.optional ? ' (optional)' : ''}: ${f.detail}`);

test('a ready machine passes every check', async () => {
  assert.deepEqual(await failing({}), []);
  assert.deepEqual(await failing({ portState: async () => 'shub', tmuxVersion: () => 'tmux next-3.6' }), []);
});

test('says what is missing', async () => {
  assert.deepEqual(await failing({ nodeVersion: '22.11.0' }), ['Node: Node 22.11.0 found, shub needs 24 or newer']);
  assert.deepEqual(await failing({ tmuxVersion: () => 'tmux 3.2a' }), [
    'tmux: tmux 3.2a found, shub needs 3.3 or newer',
  ]);
  assert.deepEqual(await failing({ tmuxVersion: () => null }), [
    'tmux: tmux is not installed: shub needs 3.3 or newer (apt install tmux, brew install tmux)',
  ]);
  assert.deepEqual(await failing({ which: () => null }), [
    'Claude Code: claude is not on PATH: install Claude Code and make sure `claude` runs in a terminal',
  ]);
  assert.deepEqual(await failing({ exists: () => false }), [
    'Docker (optional): no Docker socket at /var/run/docker.sock (optional: the services panel stays empty)',
  ]);
  assert.deepEqual(await failing({ portState: async () => 'busy' }), [
    'Port: 127.0.0.1:4780 is used by another program: stop it or set SHUB_PORT',
  ]);
});
