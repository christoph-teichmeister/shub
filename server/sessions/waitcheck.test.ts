import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck } from './waitcheck.ts';

test('parseCheck reads the last DONE / NOT YET line', () => {
  assert.deepEqual(parseCheck('Looking at the MR…\nNOT YET: no reply from Kai'), {
    done: false,
    summary: 'no reply from Kai',
  });
  assert.deepEqual(parseCheck('**DONE: Kai answered at 14:02**'), { done: true, summary: 'Kai answered at 14:02' });
  assert.equal(parseCheck('I could not reach GitLab.'), null);
});
