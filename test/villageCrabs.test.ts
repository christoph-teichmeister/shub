import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionStatus } from '../shared/api.ts';
import {
  backpack,
  crabSpots,
  giveWay,
  moodOf,
  queueOrder,
  SPACE,
  walkQueue,
  type CrabSession,
  type Walker,
} from '../web/src/lib/village/crabs.ts';
import { buildWorld, inRect } from '../web/src/lib/village/world.ts';

const world = buildWorld({
  groups: ['work', 'private'],
  projects: [
    { id: 'a', name: 'a', group: 'work', color: '#66d9ef' },
    { id: 'b', name: 'b', group: 'work', color: '#a6e22e' },
    { id: 'c', name: 'c', group: 'private', color: '#f92672' },
  ],
  active: new Set(['a', 'c']),
  activeOnly: false,
});

let n = 0;
const crab = (status: SessionStatus, projectId: string | null = 'a', at = '2026-10-21T10:00:00Z'): CrabSession => ({
  id: `s${++n}`,
  kind: projectId ? 'claude' : 'global',
  projectId,
  status,
  statusSince: at,
});

test('each status has its spot: desk, lounger, wandering, the mayor', () => {
  const list = [crab('working'), crab('paused'), crab('waiting'), crab('new'), crab('working', null)];
  const spots = crabSpots(world, list, [], 0);
  const [work, paused, waiting, fresh, mayor] = spots;
  const house = world.houses.a;
  assert.deepEqual([work.pose, work.x, work.y], ['work', house.desk.x, house.desk.y - 14]);
  assert.equal(paused.pose, 'sleep');
  assert.equal(waiting.pose, 'sleep');
  assert.ok(paused.x < house.x && waiting.x < paused.x, 'loungers side by side left of the house');
  assert.equal(fresh.pose, 'idle');
  assert.ok(inRect(fresh.x, fresh.y, house.district));
  assert.notDeepEqual([crabSpots(world, list, [], 40)[3].x], [fresh.x], 'new crabs wander');
  assert.deepEqual([mayor.mayor, mayor.x, mayor.y, mayor.pose], [true, world.mayor.x, world.mayor.y, 'work']);
});

test('the queue: needs-you first, then by join order, at the desk slots', () => {
  const late = crab('your-turn', 'a', '2026-10-21T09:00:00Z');
  const early = crab('your-turn', 'c', '2026-10-21T08:00:00Z');
  const needs = crab('needs-you', 'a', '2026-10-21T11:00:00Z');
  let q = queueOrder([late, early, needs], {});
  assert.deepEqual(q.order, [needs.id, early.id, late.id]);
  // A later arrival lines up behind, however old its activity; one that leaves loses its place.
  const newcomer = crab('your-turn', 'c', '2026-10-01T00:00:00Z');
  q = queueOrder([late, early, needs, newcomer], q.joined);
  assert.deepEqual(q.order, [needs.id, early.id, late.id, newcomer.id]);
  q = queueOrder([{ ...late, status: 'working' }, early, needs, newcomer], q.joined);
  assert.deepEqual(q.order, [needs.id, early.id, newcomer.id]);
  assert.equal(q.joined[late.id], undefined);

  const spots = crabSpots(world, [early, needs], q.order, 0);
  assert.deepEqual(
    spots.map((s) => [s.queuePos, s.x, s.y]),
    [
      [1, ...world.slots[1]],
      [0, ...world.slots[0]],
    ],
  );
});

test('crabs at home stay inside their fence; shells and unknown projects get none', () => {
  const many = Array.from({ length: 8 }, () => crab('working', 'c'));
  for (const s of crabSpots(world, many, [], 0)) assert.ok(inRect(s.x, s.y, s.district!), `${s.x},${s.y}`);
  const shell = { ...crab('working'), kind: 'shell' as const };
  assert.equal(crabSpots(world, [shell, crab('working', 'gone')], [], 0).length, 0);
});

test('keyboard triage walks the queue round, starting at the front', () => {
  const q = ['a', 'b', 'c'];
  assert.equal(walkQueue(q, null, 1), 'a');
  assert.equal(walkQueue(q, null, -1), 'a');
  assert.equal(walkQueue(q, 'gone', 1), 'a');
  assert.equal(walkQueue(q, 'a', 1), 'b');
  assert.equal(walkQueue(q, 'c', 1), 'a');
  assert.equal(walkQueue(q, 'a', -1), 'c');
  assert.equal(walkQueue([], 'a', 1), null);
});

test('the backpack grows with the context, sweat from 120k, panting from 160k', () => {
  assert.equal(backpack(undefined), null);
  assert.equal(backpack(null), null);
  const at = (tokens: number) => Object.values(backpack(tokens)!);
  assert.deepEqual(at(0), [0, false, false]);
  assert.deepEqual(at(79_999), [0, false, false]);
  assert.deepEqual(at(80_000), [1, false, false]);
  assert.deepEqual(at(120_000), [2, true, false]);
  assert.deepEqual(at(160_000), [2, true, true]);
});

test('impatience in the queue: calm, tap at 5 min, wave at 15, angry at 30', () => {
  assert.deepEqual([0, 4.9, 5, 14.9, 15, 29.9, 30, 600].map(moodOf), [
    'calm',
    'calm',
    'tap',
    'tap',
    'wave',
    'wave',
    'angry',
    'angry',
  ]);
});

test('queue crabs give way: the one further back hangs back or steps aside, never overlaps', () => {
  const w = (x: number, y: number, queuePos: number, v: [number, number] = [0, 0]): Walker => ({ x, y, v, queuePos });
  // Behind a crab ahead in line, or on top of it: hang back at SPACE (up the lane when on top).
  let [a, b] = [w(0, 0, 0, [0, 1]), w(0, -20, 1, [0, 1])];
  giveWay([a, b]);
  assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, 0, -SPACE]);
  [a, b] = [w(0, 0, 0), w(0, 0, 1)];
  giveWay([b, a]);
  assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, 0, -SPACE]);
  // In the way of one walking down the lane: steps aside to the side it is on; the front crab never moves.
  [a, b] = [w(0, 0, 0, [0, 1]), w(5, 20, 1)];
  giveWay([a, b]);
  assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, SPACE, 20]);
  // A crab leaving the queue (not queued) gets past too; crabs outside the queue are never moved.
  const [out, q] = [w(0, 0, -1, [0, -1]), w(0, -10, 3)];
  giveWay([q, out]);
  assert.deepEqual([out.x, out.y], [0, 0]);
  assert.ok(Math.hypot(q.x - out.x, q.y - out.y) >= SPACE - 1e-9);
  const [far, near] = [w(0, 0, -1), w(0, 200, 0)];
  giveWay([far, near]);
  assert.deepEqual([near.x, near.y], [0, 200]);
});

test('a crab jumping the line walks down past the waiting ones without touching them', () => {
  // The line stands on x = 0, 56 px apart (front at the bottom); the new first crab comes down the lane at x = 16
  // (a tile centre) to the slot in front of them.
  const slots = [0, -56, -112, -168];
  const line: Walker[] = slots.map((y, i) => ({ x: 0, y, v: [0, 0], queuePos: i + 1 }));
  const first: Walker = { x: 16, y: -400, v: [0, 1], queuePos: 0 };
  for (let s = 0; s < 120; s++) {
    // Each step: the first crab walks 8 px down; the others walk up to 8 px back towards their slot.
    if (first.y < 56) first.y += 8;
    else first.v = [0, 0];
    for (const [i, c] of line.entries()) {
      const [dx, dy] = [0 - c.x, slots[i] - c.y];
      const d = Math.hypot(dx, dy);
      const k = d > 8 ? 8 / d : 1;
      [c.x, c.y] = [c.x + dx * k, c.y + dy * k];
    }
    giveWay([...line, first]);
    for (const c of line)
      assert.ok(Math.hypot(c.x - first.x, c.y - first.y) >= SPACE - 1e-9, `step ${s}: crab ${c.queuePos} overlaps`);
  }
  // Once it has passed, the line is back in its slots.
  for (const [i, c] of line.entries()) assert.deepEqual([Math.round(c.x), Math.round(c.y)], [0, slots[i]]);
  assert.equal(first.y, 56);
});

test('every working crab sits at a desk of its own, and the district makes room for them', () => {
  const projects = [{ id: 'a', name: 'a', group: 'work', color: '#66d9ef' }];
  const mk = (crabs: number) =>
    buildWorld({ groups: ['work'], projects, active: new Set(['a']), activeOnly: false, crabs: { a: crabs } });
  const w = mk(4);
  const house = w.houses.a;
  assert.equal(house.desks.length, 4);
  assert.ok(w.districts[0].h > mk(1).districts[0].h, 'a second desk row needs a taller district');
  const spots = crabSpots(w, [crab('working'), crab('working'), crab('working'), crab('working')], [], 0);
  const at = spots.map((s) => `${s.x},${s.y}`);
  assert.equal(new Set(at).size, 4, 'no two crabs share a desk');
  for (const d of house.desks) assert.ok(inRect(d.x, d.y, house.district, -8));
  assert.equal(mk(1).houses.a.desks.length, 1);
  assert.equal(mk(99).houses.a.desks.length, 6);
});
