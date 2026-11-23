import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVerdict } from './turncheck.ts';

test('parseVerdict takes the last verdict word and ignores noise', () => {
  assert.equal(parseVerdict('WORKING'), 'working');
  assert.equal(parseVerdict('**NEEDS-YOU**\n'), 'needs-you');
  assert.equal(parseVerdict('Not YOUR-TURN, it is WORKING.'), 'working');
  assert.equal(parseVerdict('no idea'), null);
});
