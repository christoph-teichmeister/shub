import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session, SessionStatus } from '../shared/api.ts';
import { dropPositions, placeSessions, placeTabs, statusLabel } from '../web/src/lib/status.ts';

const s = (id: string, status: SessionStatus, position: number | null = null) => ({ id, status, position });
const ids = (list: { id: string }[]) => list.map((x) => x.id).join(' ');

test('sidebar: needs you, your turn, working, then the rest, oldest first', () => {
  const list = [s('a', 'paused'), s('b', 'working'), s('c', 'your-turn'), s('d', 'needs-you'), s('e', 'new')];
  assert.equal(ids(placeSessions(list)), 'd c b a e');
});

test('pinned sessions stay on top in their pinned order, even above needs you', () => {
  const list = [s('a', 'paused', 4), s('b', 'working'), s('c', 'needs-you'), s('d', 'paused', 1)];
  assert.equal(ids(placeSessions(list)), 'd a c b');
});

test('tabs: dragged ones in their order, the rest after, oldest first; status and pins never matter', () => {
  const t = (id: string, tabPosition: number | null = null, position: number | null = null) => ({
    id,
    tabPosition,
    position,
  });
  assert.equal(ids(placeTabs([t('a'), t('b', null, 0), t('c', 1), t('d', 0)])), 'd c a b');
});

test('dropping pins the moved session and every already pinned one at their new index', () => {
  const list = [s('c', 'needs-you'), s('a', 'paused', 1), s('b', 'working')];
  assert.deepEqual(dropPositions(list, 'b', 'c'), { b: 0, a: 2 });
  assert.deepEqual(dropPositions(list, 'c', null), { a: 0, c: 2 });
  assert.deepEqual(dropPositions(list, 'c', 'c'), {});
  const after = list.map((x) => ({ ...x, position: dropPositions(list, 'b', 'c')[x.id] ?? x.position }));
  assert.equal(ids(placeSessions(after)), 'b a c');
});

test('dropping a tab saves the whole tab order', () => {
  const list = [s('a', 'paused'), s('b', 'working'), s('c', 'new')];
  assert.deepEqual(dropPositions(list, 'c', 'a', true), { c: 0, a: 1, b: 2 });
});

test('a finished turn names the background shells still running', () => {
  const label = (status: SessionStatus, shells: number) => statusLabel({ status, shells } as Session);
  assert.equal(label('your-turn', 2), 'your turn · 2 shells');
  assert.equal(label('waiting', 1), 'waiting · 1 shell');
  assert.equal(label('working', 2), 'working');
  assert.equal(label('your-turn', 0), 'your turn');
});

test('a finished turn with agents still running reads idle, not working', () => {
  const agent = { id: 'a', type: 'agent' };
  const label = (s: object) => statusLabel({ status: 'working', ...s } as Session);
  assert.equal(label({ background: true, agents: [agent] }), 'idle · 1 agent');
  assert.equal(label({ background: true, agents: [agent, agent] }), 'idle · 2 agents');
  assert.equal(label({ agents: [agent] }), 'working');
});
