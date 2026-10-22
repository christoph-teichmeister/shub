import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampRect, closeTab, keepTabs, MIN_H, MIN_W, NO_CHATS, openTab } from '../web/src/lib/village/chats.ts';

test('opening adds a tab once and shows it', () => {
  let c = openTab(NO_CHATS, 'a');
  c = openTab(c, 'b');
  assert.deepEqual(c, { ids: ['a', 'b'], active: 'b' });
  assert.deepEqual(openTab(c, 'a'), { ids: ['a', 'b'], active: 'a' });
});

test('closing the shown tab shows its neighbour; the last one closes the window', () => {
  const c = { ids: ['a', 'b', 'c'], active: 'b' };
  assert.deepEqual(closeTab(c, 'b'), { ids: ['a', 'c'], active: 'c' });
  assert.deepEqual(closeTab({ ...c, active: 'c' }, 'c'), { ids: ['a', 'b'], active: 'b' });
  assert.deepEqual(closeTab(c, 'a'), { ids: ['b', 'c'], active: 'b' });
  assert.deepEqual(closeTab({ ids: ['a'], active: 'a' }, 'a'), NO_CHATS);
});

test('a tab whose session vanished closes itself', () => {
  const c = { ids: ['a', 'b', 'c'], active: 'b' };
  assert.deepEqual(keepTabs(c, new Set(['a', 'c'])), { ids: ['a', 'c'], active: 'c' });
  assert.deepEqual(keepTabs(c, new Set()), NO_CHATS);
  assert.equal(keepTabs(c, new Set(['a', 'b', 'c'])), c);
});

test('the window stays inside the browser window, between its minimum and the whole window', () => {
  assert.deepEqual(clampRect({ x: 100, y: 50, w: 600, h: 400 }, 1440, 900), { x: 100, y: 50, w: 600, h: 400 });
  // Dragged past the right and bottom edges, or above and left of the window.
  assert.deepEqual(clampRect({ x: 1200, y: 800, w: 600, h: 400 }, 1440, 900), { x: 840, y: 500, w: 600, h: 400 });
  assert.deepEqual(clampRect({ x: -50, y: -20, w: 600, h: 400 }, 1440, 900), { x: 0, y: 0, w: 600, h: 400 });
  // Too small, too big, and a browser window smaller than the minimum.
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 10, h: 10 }, 1440, 900), { x: 0, y: 0, w: MIN_W, h: MIN_H });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, 1440, 900), { x: 0, y: 0, w: 1440, h: 900 });
  assert.deepEqual(clampRect({ x: 30, y: 30, w: 600, h: 400 }, 300, 200), { x: 0, y: 0, w: 300, h: 200 });
});
