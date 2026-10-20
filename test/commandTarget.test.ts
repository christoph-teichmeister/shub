import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../shared/api.ts';
import { commandTarget } from '../shared/commands.ts';

const s = (id: string, cwd: string, status = 'your-turn', kind = 'claude') => ({ id, cwd, status, kind }) as Session;
const sessions = [s('a', '/p'), s('b', '/p/w', 'exited'), s('c', '/p/w'), s('sh', '/x', 'your-turn', 'shell')];

test('commandTarget: none or own = self, then by id, then by folder', () => {
  assert.deepEqual(commandTarget({ command: 'ls' }, sessions, 'a'), { kind: 'self' });
  assert.deepEqual(commandTarget({ command: 'ls', session: 'a' }, sessions, 'a'), { kind: 'self' });
  assert.deepEqual(commandTarget({ command: 'ls', session: 'b' }, sessions, 'a'), {
    kind: 'session',
    session: sessions[1],
    running: false,
  });
  assert.equal(commandTarget({ command: 'ls', cwd: '/p/w' }, sessions, 'a').kind, 'session', 'live c, not exited b');
  assert.deepEqual(commandTarget({ command: 'ls', cwd: '/x' }, sessions, 'a'), { kind: 'folder', cwd: '/x' });
  assert.deepEqual(commandTarget({ command: 'ls', session: 'zz' }, sessions, 'a'), { kind: 'unknown', ref: 'zz' });
});
