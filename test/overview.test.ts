import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../shared/api.ts';
import { overviewSessions } from '../web/src/lib/overview.ts';

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

test('overviewSessions: needs-you first, panes rolled up, shells and exited left out, project filter', () => {
  const all = [
    s('a', 'your-turn'),
    s('b', 'working'),
    s('c', 'needs-you'),
    s('d', 'your-turn', { projectId: 'q' }),
    s('e', 'exited'),
    s('f', 'working', { kind: 'shell' }),
    s('g', 'needs-you', { parentId: 'd' }),
  ];
  assert.deepEqual(
    overviewSessions(all).map((x) => x.id),
    ['c', 'd', 'b', 'a'],
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
