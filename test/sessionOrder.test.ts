import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session, SessionStatus } from '../shared/api.ts';
import { dropPositions, placeSessions, statusLabel } from '../web/src/lib/status.ts';

const s = (id: string, status: SessionStatus, position: number | null = null) => ({ id, status, position });
const ids = (list: { id: string }[]) => list.map((x) => x.id).join(' ');

test('sidebar: needs you, your turn, working, then the rest, oldest first', () => {
  const list = [s('a', 'paused'), s('b', 'working'), s('c', 'your-turn'), s('d', 'needs-you'), s('e', 'new')];
  assert.equal(ids(placeSessions(list, true)), 'd c b a e');
  assert.equal(ids(placeSessions(list, false)), 'a b c d e');
});

test('a dragged session keeps its place, the rest fill the gaps', () => {
  const list = [s('a', 'paused', 0), s('b', 'working'), s('c', 'needs-you'), s('d', 'paused', 9)];
  assert.equal(ids(placeSessions(list, true)), 'a c b d');
});

test('dropping pins the moved session and every already pinned one at their new index', () => {
  const list = [s('c', 'needs-you'), s('a', 'paused', 1), s('b', 'working')];
  assert.deepEqual(dropPositions(list, 'b', 'c'), { b: 0, a: 2 });
  assert.deepEqual(dropPositions(list, 'c', null), { a: 0, c: 2 });
  assert.deepEqual(dropPositions(list, 'c', 'c'), {});
  const after = list.map((x) => ({ ...x, position: dropPositions(list, 'b', 'c')[x.id] ?? x.position }));
  assert.equal(ids(placeSessions(after, true)), 'b c a');
});

test('a finished turn names the background shells still running', () => {
  const label = (status: SessionStatus, shells: number) => statusLabel({ status, shells } as Session);
  assert.equal(label('your-turn', 2), 'your turn · 2 shells');
  assert.equal(label('waiting', 1), 'waiting · 1 shell');
  assert.equal(label('working', 2), 'working');
  assert.equal(label('your-turn', 0), 'your turn');
});
