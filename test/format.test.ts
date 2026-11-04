import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, dayAge, mmss, shortAge } from '../web/src/lib/format.ts';

const before = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

test('mmss pads the seconds', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(65_000), '1:05');
  assert.equal(mmss(10 * MIN), '10:00');
});

test('the three ages keep their own formats', () => {
  assert.deepEqual([before(5 * MIN), before(3 * 60 * MIN), before(2 * DAY)].map(shortAge), ['5 min', '3 h', '2 d']);
  assert.deepEqual([null, before(MIN), before(3 * DAY)].map(dayAge), ['', 'today', '3d']);
  assert.deepEqual([before(MIN), before(DAY), before(5 * DAY), before(21 * DAY), before(90 * DAY)].map(ago), [
    'today',
    'yesterday',
    '5 days ago',
    '3 weeks ago',
    '3 months ago',
  ]);
});
