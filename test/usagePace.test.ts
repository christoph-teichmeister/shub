import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pace, workweekPace } from '../web/src/lib/usagePace.ts';

const sec = (s: string) => new Date(s).getTime() / 1000;

test('pace is linear over the window', () => {
  assert.equal(pace(1000, 100, 950), 50);
  assert.equal(pace(1000, 100, 2000), 100);
});

test('workweekPace runs to Friday 16:00 before a Saturday 20:00 reset', () => {
  const reset = sec('2026-11-28T20:00:00'); // Saturday
  const start = reset - 7 * 86400;
  const end = sec('2026-11-27T16:00:00'); // Friday
  assert.equal(workweekPace(reset, start), 0);
  assert.equal(workweekPace(reset, (start + end) / 2), 50);
  assert.equal(workweekPace(reset, end), 100);
  assert.equal(workweekPace(reset, reset - 3600), 100); // weekend stays capped
});

test('workweekPace for a Wednesday reset ends the previous Friday', () => {
  const reset = sec('2026-12-02T10:00:00'); // Wednesday
  assert.equal(workweekPace(reset, sec('2026-11-27T16:00:00')), 100);
});
