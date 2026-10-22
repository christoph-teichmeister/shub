import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readNotes, saveNotes } from './index.ts';

test('a save wins only against the text the editor saw', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'shub-notes-')), 'notes', 'a.md');
  const first = readNotes(file);
  assert.equal(first.text, '');
  const saved = saveNotes(file, 'mine', first.rev);
  assert.ok(saved);
  assert.equal(readFileSync(file, 'utf8'), 'mine');
  // Claude edits the file; the editor still holds the old revision.
  writeFileSync(file, 'claude was here');
  assert.equal(saveNotes(file, 'mine again', saved.rev), null);
  assert.equal(readFileSync(file, 'utf8'), 'claude was here');
  assert.ok(saveNotes(file, 'mine again', readNotes(file).rev));
});
