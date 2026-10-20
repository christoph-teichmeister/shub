import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTitle } from './title.ts';

test('cleanTitle keeps the first line without quotes, labels or a trailing period', () => {
  assert.equal(cleanTitle('Bessere Session-Namen generieren\n'), 'Bessere Session-Namen generieren');
  assert.equal(cleanTitle('"Fix login redirect."'), 'Fix login redirect');
  assert.equal(cleanTitle('Title: **Docker cleanup**\nmore text'), 'Docker cleanup');
  assert.equal(cleanTitle('  '), null);
  assert.equal(cleanTitle('x'.repeat(61)), null);
});
