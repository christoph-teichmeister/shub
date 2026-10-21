import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionStatus } from '../shared/api.ts';
import { backpack, crabSpots, moodOf, queueOrder, walkQueue, type CrabSession } from '../web/src/lib/village/crabs.ts';
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
