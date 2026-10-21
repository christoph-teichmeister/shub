import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../shared/api.ts';
import { contextFill } from '../web/src/lib/status.ts';

const fill = (tokens: number, window: number) => contextFill({ context: { tokens, window } } as Session);

test('contextFill colours by tokens, so a 1M session warns as early as a 200k one', () => {
  assert.deepEqual(fill(160_000, 1_000_000), {
    pct: 16,
    level: 'high',
    compact: true,
    title: 'Context 160k / 1M · 16 %',
  });
  assert.equal(fill(130_000, 200_000)?.level, 'mid');
  assert.equal(fill(119_000, 1_000_000)?.level, 'low');
  assert.equal(fill(119_000, 1_000_000)?.compact, false);
  assert.equal(contextFill({ context: null } as Session), null);
});
