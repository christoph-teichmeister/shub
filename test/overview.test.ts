import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../shared/api.ts';
import {
  capLive,
  equalize,
  leaves,
  type Layout,
  moveToEdge,
  dropZone,
  neighbour,
  neighbourByRect,
  overviewSessions,
  parseLayout,
  pruneMinimized,
  reconcile,
  rects,
  resize,
  serializeLayout,
  setSizes,
  swap,
  MIN_SIZE,
  type Split,
} from '../web/src/lib/overview.ts';

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

test('capLive: needs-you always live, promoted next, newest others displaced', () => {
  const w = [s('a', 'needs-you'), s('b', 'working'), s('cc', 'working'), s('ddd', 'your-turn'), s('ee', 'needs-you')];
  const ids = (l: Session[]) => l.map((x) => x.id);
  assert.deepEqual(ids(capLive(w, 3).live), ['a', 'b', 'ee']);
  assert.deepEqual(ids(capLive(w, 3).over), ['cc', 'ddd']);
  assert.deepEqual(ids(capLive(w, 3, ['ddd']).live), ['a', 'ddd', 'ee']);
  assert.deepEqual(ids(capLive(w, 1).live), ['a', 'ee']);
});

const row = (children: Layout[], sizes = children.map(() => 1 / children.length)): Split => ({
  dir: 'row',
  children,
  sizes,
});
const col = (children: Layout[], sizes = children.map(() => 1 / children.length)): Split => ({
  dir: 'col',
  children,
  sizes,
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('rects: nested sizes map to unit rectangles', () => {
  assert.deepEqual([...rects('a')], [['a', { x: 0, y: 0, w: 1, h: 1 }]]);
  assert.equal(rects(null).size, 0);
  const r = rects(row(['a', col(['b', 'c'], [0.25, 0.75])], [0.4, 0.6]));
  assert.deepEqual(r.get('a'), { x: 0, y: 0, w: 0.4, h: 1 });
  near(r.get('b')!.x, 0.4);
  near(r.get('b')!.h, 0.25);
  near(r.get('c')!.y, 0.25);
  near(r.get('c')!.w, 0.6);
});

test('reconcile: empty and single', () => {
  assert.equal(reconcile(null, []), null);
  assert.equal(reconcile(null, ['a']), 'a');
  assert.equal(reconcile('a', []), null);
  assert.equal(reconcile('a', ['a']), 'a');
});

test('reconcile: dead leaves drop, one-child splits collapse, siblings share the space', () => {
  assert.equal(reconcile(row(['a', 'b']), ['a']), 'a');
  const t = reconcile(row(['a', col(['b', 'c']), 'd'], [0.2, 0.6, 0.2]), ['a', 'b', 'd']) as Split;
  assert.deepEqual(t.children, ['a', 'b', 'd']);
  assert.deepEqual(t.sizes, [0.2, 0.6, 0.2]);
  const s = reconcile(row(['a', 'b', 'c'], [0.2, 0.3, 0.5]), ['a', 'b']) as Split;
  near(s.sizes[0], 0.4);
  near(s.sizes[1], 0.6);
});

test('reconcile: a tree that is already right is left as it is', () => {
  const t = row(['a', col(['b', 'c'])], [0.3, 0.7]);
  assert.deepEqual(reconcile(t, ['c', 'b', 'a']), t);
});

test('reconcile: new sessions split the largest leaf along its longer side', () => {
  assert.deepEqual(reconcile('a', ['a', 'b']), row(['a', 'b'], [0.5, 0.5]));
  const t = reconcile(row(['a', 'b'], [0.7, 0.3]), ['a', 'b', 'c']) as Split;
  assert.deepEqual(t.children[0], col(['a', 'c'], [0.5, 0.5]));
  assert.equal(t.children[1], 'b');
  assert.deepEqual(leaves(reconcile(null, ['a', 'b', 'c'])).sort(), ['a', 'b', 'c']);
});

test('reconcile: building from nothing keeps every id once, duplicates and unknown ids ignored', () => {
  const t = reconcile(row(['a', 'a', 'x']) as Layout, ['a', 'b', 'c', 'd']);
  assert.deepEqual([...leaves(t)].sort(), ['a', 'b', 'c', 'd']);
  for (const r of rects(t).values()) assert.ok(r.w > 0 && r.h > 0);
  near(
    [...rects(t).values()].reduce((n, r) => n + r.w * r.h, 0),
    1,
  );
});

test('setSizes: replaces, normalises, ignores bad input', () => {
  const t = row(['a', 'b']);
  assert.deepEqual((setSizes(t, [], [0.3, 0.7]) as Split).sizes, [0.3, 0.7]);
  near((setSizes(t, [], [3, 7]) as Split).sizes[0], 0.3);
  assert.deepEqual((setSizes(t, [], [0.1, 0.9]) as Split).sizes, [0.5, 0.5]);
  assert.deepEqual((setSizes(t, [], [1]) as Split).sizes, [0.5, 0.5]);
  assert.deepEqual((setSizes(t, [], [NaN, 0.5]) as Split).sizes, [0.5, 0.5]);
  assert.equal(setSizes('a', [], [1]), 'a');
});

test('setSizes and resize reach nested splits by path, bad paths do nothing', () => {
  const t = row(['a', col(['b', 'c'])]);
  const r = resize(t, [1], 0, 0.1) as Split;
  near((r.children[1] as Split).sizes[0], 0.6);
  assert.deepEqual(r.sizes, [0.5, 0.5]);
  assert.deepEqual(resize(t, [5], 0, 0.1), t);
  assert.deepEqual(resize(t, [0], 0, 0.1), t);
  assert.deepEqual((setSizes(t, [1], [0.2, 0.8]) as Split & { children: Split[] }).children[1].sizes, [0.2, 0.8]);
});

test('resize: moves the divider, clamps both neighbours to MIN_SIZE, never changes the sum', () => {
  const t = row(['a', 'b', 'c'], [0.3, 0.3, 0.4]);
  const m = resize(t, [], 0, 0.1) as Split;
  near(m.sizes[0], 0.4);
  near(m.sizes[1], 0.2);
  near(m.sizes[2], 0.4);
  const big = resize(t, [], 0, 5) as Split;
  near(big.sizes[1], MIN_SIZE);
  near(big.sizes[0], 0.6 - MIN_SIZE);
  const small = resize(t, [], 1, -5) as Split;
  near(small.sizes[1], MIN_SIZE);
  near(sum(small.sizes), 1);
  assert.deepEqual(resize(t, [], 2, 0.1), t);
  assert.deepEqual(resize(t, [], -1, 0.1), t);
  assert.deepEqual(resize('a', [], 0, 0.1), 'a');
});

test('resize: a neighbour already under MIN_SIZE never shrinks further and does not jump', () => {
  const t = row(['a', 'b'], [0.05, 0.95]);
  assert.deepEqual((resize(t, [], 0, -0.1) as Split).sizes, [0.05, 0.95]);
  const grow = resize(t, [], 0, 0.1) as Split;
  near(grow.sizes[0], 0.15);
  near(grow.sizes[1], 0.85);
  near((resize(t, [], 0, 5) as Split).sizes[1], MIN_SIZE);
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test('equalize: equal shares for the split at the path', () => {
  const t = row(['a', col(['b', 'c', 'd'], [0.2, 0.2, 0.6])], [0.8, 0.2]);
  const e = equalize(t, []) as Split;
  assert.deepEqual(e.sizes, [0.5, 0.5]);
  near(((equalize(t, [1]) as Split).children[1] as Split).sizes[2], 1 / 3);
  assert.equal(equalize('a', []), 'a');
  assert.deepEqual(equalize(t, [9]), t);
});

test('swap: exchanges two leaves anywhere, unknown or equal ids change nothing', () => {
  const t = row(['a', col(['b', 'c'])], [0.3, 0.7]);
  assert.deepEqual(swap(t, 'a', 'c'), row(['c', col(['b', 'a'])], [0.3, 0.7]));
  assert.deepEqual(swap(t, 'b', 'c'), row(['a', col(['c', 'b'])], [0.3, 0.7]));
  assert.equal(swap(t, 'a', 'a'), t);
  assert.equal(swap(t, 'a', 'x'), t);
  assert.equal(swap('a', 'a', 'b'), 'a');
});

test('moveToEdge: takes the leaf out and wraps the target on the chosen edge', () => {
  const t = row(['a', 'b', 'c'], [0.2, 0.3, 0.5]);
  const r = moveToEdge(t, 'a', 'c', 'right') as Split;
  assert.deepEqual(r.children, ['b', 'c', 'a']);
  [0.375, 0.3125, 0.3125].forEach((x, i) => near(r.sizes[i], x));
  assert.deepEqual((moveToEdge(t, 'c', 'a', 'top') as Split).children[0], col(['c', 'a'], [0.5, 0.5]));
  assert.deepEqual((moveToEdge(t, 'a', 'b', 'left') as Split).children, ['a', 'b', 'c']);
  assert.deepEqual((moveToEdge(t, 'a', 'b', 'bottom') as Split).children[0], col(['b', 'a'], [0.5, 0.5]));
});

test('moveToEdge: same direction as the parent joins as a sibling, repeated moves do not nest', () => {
  let t: Layout = row(['a', 'b', 'c']);
  t = moveToEdge(t, 'a', 'c', 'right');
  t = moveToEdge(t, 'b', 'c', 'right');
  assert.deepEqual(leaves(t), ['c', 'b', 'a']);
  assert.ok((t as Split).children.every((c) => typeof c === 'string'));
});

test('reconcile: leaves too small to halve are skipped while a bigger one exists', () => {
  const t = row([col(['a', 'b'], [0.5, 0.5]), 'c'], [0.1, 0.9]) as Layout;
  const r = reconcile(t, ['a', 'b', 'c', 'd']) as Split;
  assert.deepEqual(r.children[0], t && (t as Split).children[0]);
  assert.deepEqual(leaves(r).sort(), ['a', 'b', 'c', 'd']);
  // nothing fits: still places the id
  assert.deepEqual(leaves(reconcile(row(['a', 'b'], [0.5, 0.5]), ['a', 'b'])).sort(), ['a', 'b']);
});

test('moveToEdge: two leaves collapse and rewrap, bad moves change nothing', () => {
  assert.deepEqual(moveToEdge(row(['a', 'b']), 'a', 'b', 'bottom'), col(['b', 'a'], [0.5, 0.5]));
  const t = row(['a', 'b']);
  assert.equal(moveToEdge(t, 'a', 'a', 'left'), t);
  assert.equal(moveToEdge(t, 'x', 'a', 'left'), t);
  assert.equal(moveToEdge(t, 'a', 'x', 'left'), t);
  assert.equal(moveToEdge('a', 'a', 'b', 'left'), 'a');
});

test('serializeLayout and parseLayout round-trip', () => {
  const t = row(['a', col(['b', 'c'], [0.25, 0.75])], [0.4, 0.6]);
  assert.deepEqual(parseLayout(serializeLayout(t)), t);
  assert.equal(parseLayout(serializeLayout('a')), 'a');
  near((parseLayout('{"dir":"row","children":["a","b"],"sizes":[1,3]}') as Split).sizes[0], 0.25);
});

test('parseLayout: garbage gives null', () => {
  for (const raw of [
    null,
    '',
    'nope',
    '{',
    'null',
    '42',
    '""',
    '[]',
    '{}',
    '{"dir":"diag","children":["a","b"],"sizes":[0.5,0.5]}',
    '{"dir":"row","children":["a"],"sizes":[1]}',
    '{"dir":"row","children":["a","b"],"sizes":[1]}',
    '{"dir":"row","children":["a","b"],"sizes":[0,1]}',
    '{"dir":"row","children":["a","b"],"sizes":[-1,2]}',
    '{"dir":"row","children":["a","b"],"sizes":["x",1]}',
    '{"dir":"row","children":["a",1],"sizes":[0.5,0.5]}',
    '{"dir":"row","children":["a","a"],"sizes":[0.5,0.5]}',
    '{"dir":"row","children":["a",{"dir":"col","children":["b"],"sizes":[1]}],"sizes":[0.5,0.5]}',
    '{"dir":"row","children":"ab","sizes":[0.5,0.5]}',
  ])
    assert.equal(parseLayout(raw), null, String(raw));
});

import { gridLayout } from '../web/src/lib/overview.ts';

test('gridLayout is rows of cols panes; a short last row shares the whole row', () => {
  assert.equal(gridLayout([], 2), null);
  assert.equal(gridLayout(['a'], 2), 'a');
  assert.deepEqual(gridLayout(['a', 'b'], 2), { dir: 'row', children: ['a', 'b'], sizes: [0.5, 0.5] });
  assert.deepEqual(gridLayout(['a', 'b'], 1), { dir: 'col', children: ['a', 'b'], sizes: [0.5, 0.5] });
  assert.deepEqual(gridLayout(['a', 'b', 'c'], 2), {
    dir: 'col',
    children: [{ dir: 'row', children: ['a', 'b'], sizes: [0.5, 0.5] }, 'c'],
    sizes: [0.5, 0.5],
  });
});

test('neighbourByRect: nearest pane by position, stays at edges, skips panes that are not in that direction', () => {
  // left: a tall; right: b over c
  const t: Layout = {
    dir: 'row',
    sizes: [0.5, 0.5],
    children: ['a', { dir: 'col', sizes: [0.5, 0.5], children: ['b', 'c'] }],
  };
  assert.equal(neighbourByRect(t, 'a', 'right'), 'b');
  assert.equal(neighbourByRect(t, 'c', 'left'), 'a');
  assert.equal(neighbourByRect(t, 'b', 'down'), 'c');
  assert.equal(neighbourByRect(t, 'c', 'down'), 'c');
  assert.equal(neighbourByRect(t, 'a', 'up'), 'a');
  assert.equal(neighbourByRect(t, 'x', 'up'), 'x');
});

test('dropZone: outer quarter is the nearest edge, the middle swaps', () => {
  assert.equal(dropZone(0.5, 0.5), 'center');
  assert.equal(dropZone(0.1, 0.5), 'left');
  assert.equal(dropZone(0.9, 0.4), 'right');
  assert.equal(dropZone(0.5, 0.05), 'top');
  assert.equal(dropZone(0.6, 0.95), 'bottom');
  assert.equal(dropZone(0.1, 0.2), 'left');
});
