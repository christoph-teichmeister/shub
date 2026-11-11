import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../shared/api.ts';
import { neighbour, overviewSessions, pruneMinimized } from '../web/src/lib/overview.ts';

const s = (id: string, status: Session['status'], extra: Partial<Session> = {}) =>
  ({
    id,
    status,
    kind: 'claude',
    projectId: 'p',
    parentId: null,
    createdAt: `2026-11-0${id.length}T00:00:00Z`,
    ...extra,
  }) as Session;

test('overviewSessions: stable creation order, shells, the global session and exited left out, project filter', () => {
  const all = [
    s('a', 'your-turn'),
    s('b', 'working'),
    s('c', 'needs-you'),
    s('d', 'your-turn', { projectId: 'q' }),
    s('e', 'exited'),
    s('f', 'working', { kind: 'shell' }),
    s('h', 'working', { kind: 'global' }),
    s('g', 'needs-you', { parentId: 'd' }),
  ];
  assert.deepEqual(
    overviewSessions(all).map((x) => x.id),
    ['a', 'b', 'c', 'd'],
  );
  all[0]!.status = 'needs-you'; // a status change must not reorder
  assert.deepEqual(
    overviewSessions(all).map((x) => x.id),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(
    overviewSessions(all, 'q').map((x) => x.id),
    ['d'],
  );
});

import { gridColumns } from '../web/src/lib/overview.ts';

test('gridColumns picks terminal-shaped cells on a wide and a tall screen', () => {
  assert.equal(gridColumns(1, 3840, 2000), 1);
  assert.equal(gridColumns(12, 3840, 2000), 4); // 4 x 3 -> 960 x 667
  assert.equal(gridColumns(4, 1000, 1600), 1); // tall: stacked
  assert.equal(gridColumns(0, 100, 100), 1);
});

test('neighbour: moves in a 3-column grid of 5, stays at edges, down from a missing cell goes to the last pane', () => {
  assert.equal(neighbour(0, 'right', 3, 5), 1);
  assert.equal(neighbour(2, 'right', 3, 5), 2);
  assert.equal(neighbour(4, 'right', 3, 5), 4);
  assert.equal(neighbour(3, 'left', 3, 5), 3);
  assert.equal(neighbour(4, 'up', 3, 5), 1);
  assert.equal(neighbour(0, 'up', 3, 5), 0);
  assert.equal(neighbour(1, 'down', 3, 5), 4);
  assert.equal(neighbour(2, 'down', 3, 5), 4);
  assert.equal(neighbour(4, 'down', 3, 5), 4);
});

test('pruneMinimized: drops ids of gone sessions, keeps the list while the store is empty', () => {
  const all = [s('a', 'working')];
  assert.deepEqual(pruneMinimized(['a', 'zz'], all), ['a']);
  const same = ['a'];
  assert.equal(pruneMinimized(same, all), same);
  assert.deepEqual(pruneMinimized(['a'], []), ['a']);
});
