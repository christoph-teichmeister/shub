import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { viewableImage } from './image.ts';

test('viewableImage allows images under /tmp/claude-* and the pastes folder only', () => {
  const claude = mkdtempSync(join(tmpdir(), 'claude-test-'));
  const other = mkdtempSync(join(tmpdir(), 'other-test-'));
  const state = mkdtempSync(join(tmpdir(), 'state-test-'));
  try {
    mkdirSync(join(state, 'pastes'));
    for (const f of [
      join(claude, 'a.png'),
      join(other, 'b.png'),
      join(state, 'pastes', 'c.jpg'),
      join(claude, 'd.txt'),
    ]) {
      writeFileSync(f, 'x');
    }
    symlinkSync(join(other, 'b.png'), join(claude, 'link.png'));

    assert.equal(viewableImage(join(claude, 'a.png'), state)?.type, 'image/png');
    assert.equal(viewableImage(join(state, 'pastes', 'c.jpg'), state)?.type, 'image/jpeg');
    assert.equal(viewableImage(join(other, 'b.png'), state), null, 'outside the allowed folders');
    assert.equal(viewableImage(join(claude, 'link.png'), state), null, 'symlink out of the folder');
    assert.equal(viewableImage(join(claude, 'd.txt'), state), null, 'not an image');
    assert.equal(viewableImage(join(claude, 'missing.png'), state), null, 'missing file');
    assert.equal(viewableImage('a.png', state), null, 'relative path');
  } finally {
    for (const d of [claude, other, state]) rmSync(d, { recursive: true, force: true });
  }
});
