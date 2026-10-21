import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ambientSpots,
  birds,
  butterflies,
  CHEER_STEPS,
  cheerFrame,
  clouds,
  isDark,
  timeOfDay,
} from '../web/src/lib/village/ambience.ts';
import type { World } from '../web/src/lib/village/world.ts';

test('the time of day follows the hour: 5-9 morning, 9-18 day, 18-21 evening, else night', () => {
  const by = Array.from({ length: 24 }, (_, h) => timeOfDay(h));
  assert.deepEqual(by, [
    ...Array(5).fill('night'),
    ...Array(4).fill('morning'),
    ...Array(9).fill('day'),
    ...Array(3).fill('evening'),
    ...Array(3).fill('night'),
  ]);
  assert.deepEqual(
    ['morning', 'day', 'evening', 'night'].map((d) => isDark(d as never)),
    [false, false, true, true],
  );
});

test('a celebration hops, then its confetti falls and fades, then it is over', () => {
  assert.equal(cheerFrame(0, false).confetti.length, 9);
  assert.equal(cheerFrame(0, true).confetti.length, 18);
  assert.ok(cheerFrame(3, false).hop < 0);
  assert.equal(cheerFrame(12, false).hop, 0);
  const late = cheerFrame(20, true).confetti;
  assert.ok(late.every((p) => p.opacity < 0.2));
  assert.deepEqual(cheerFrame(CHEER_STEPS, true), { hop: 0, confetti: [] });
});

test('ambience scales with the map and stays inside it', () => {
  const small = { W: 2000, H: 1500, pond: { x: 300, y: 300 } } as World;
  const big = { W: 6000, H: 4000, pond: { x: 300, y: 300 } } as World;
  assert.ok(ambientSpots(big).fireflies.length > ambientSpots(small).fireflies.length * 2);
  assert.ok(butterflies(big, 0).length > butterflies(small, 0).length);
  assert.deepEqual(ambientSpots(big), ambientSpots(big));
  for (const [x, y] of ambientSpots(big).fireflies) assert.ok(x >= 0 && x <= big.W && y >= 0 && y <= big.H);
  for (const t of [0, 77, 900])
    for (const f of [...butterflies(big, t), ...birds(big, t)])
      assert.ok(f.y > -50 && f.y < big.H + 50, `${f.src} y ${f.y}`);
  assert.ok(clouds(big, 5).length >= 3);
});
