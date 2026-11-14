import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../shared/api.ts';
import { commandTarget } from '../shared/commands.ts';

const s = (id: string, cwd: string, status = 'your-turn', kind = 'claude') => ({ id, cwd, status, kind }) as Session;
const sessions = [s('a', '/p'), s('b', '/p/w', 'exited'), s('c', '/p/w'), s('sh', '/x', 'your-turn', 'shell')];

test('commandTarget: none or own = self, then by id, a folder opens a terminal and never reroutes', () => {
  assert.deepEqual(commandTarget({ command: 'ls' }, sessions, 'a'), { kind: 'self' });
  assert.deepEqual(commandTarget({ command: 'ls', session: 'a' }, sessions, 'a'), { kind: 'self' });
  assert.deepEqual(commandTarget({ command: 'ls', session: 'b' }, sessions, 'a'), {
    kind: 'session',
    session: sessions[1],
    running: false,
  });
  assert.deepEqual(
    commandTarget({ command: 'ls', cwd: '/p/w' }, sessions, 'a'),
    { kind: 'folder', cwd: '/p/w' },
    'live c is not hijacked',
  );
  assert.deepEqual(commandTarget({ command: 'ls', cwd: '/p' }, sessions, 'a'), { kind: 'self' }, 'own folder');
  assert.deepEqual(commandTarget({ command: 'ls', cwd: '/x' }, sessions, 'a'), { kind: 'folder', cwd: '/x' });
  assert.deepEqual(commandTarget({ command: 'ls', session: 'zz' }, sessions, 'a'), { kind: 'unknown', ref: 'zz' });
});
