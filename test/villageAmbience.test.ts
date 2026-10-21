import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHEER_STEPS, cheerFrame, isDark, timeOfDay } from '../web/src/lib/village/ambience.ts';

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
