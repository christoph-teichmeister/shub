import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { noteFile, noteUrl } from './markdown.ts';

test('noteUrl links existing notes inside the knowledge base only', () => {
  const kb = mkdtempSync(join(tmpdir(), 'kb-test-'));
  const outside = mkdtempSync(join(tmpdir(), 'other-test-'));
  try {
    mkdirSync(join(kb, 'Decisions'));
    writeFileSync(join(kb, 'Decisions', '2026-10-23 Shub Device Group.md'), 'x');
    writeFileSync(join(outside, 'x.md'), 'x');
    const env = { KB_DIR: kb, KB_CARD_URL: 'https://ha/kb/cards/{id}' };

    assert.equal(
      noteUrl('Decisions/2026-10-23 Shub Device Group.md', env),
      'https://ha/kb/notes/Decisions/2026-10-23%20Shub%20Device%20Group',
    );
    assert.equal(
      noteUrl(join(kb, 'Decisions', '2026-10-23 Shub Device Group.md'), env)?.startsWith('https://ha/kb/notes/'),
      true,
    );
    assert.equal(
      noteFile('Decisions/2026-10-23 Shub Device Group.md', env)?.name,
      'Decisions/2026-10-23 Shub Device Group',
    );
    assert.equal(noteFile(join(outside, 'x.md'), env), null);
    assert.equal(noteUrl('Decisions/Missing.md', env), null);
    assert.equal(noteUrl(join(outside, 'x.md'), env), null);
    assert.equal(noteUrl('../' + outside.split('/').pop() + '/x.md', env), null);
    assert.equal(noteUrl('Decisions/2026-10-23 Shub Device Group.md', { KB_DIR: kb }), null);
  } finally {
    rmSync(kb, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});

test('noteFile opens Claude scratchpad drafts but not other files in tmp', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tmp-test-'));
  try {
    const dir = join(tmp, `claude-${process.getuid?.()}`, 'proj', 'scratchpad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'draft.md'), 'x');
    writeFileSync(join(tmp, 'other.md'), 'x');
    const env = { KB_DIR: join(tmp, 'no-kb'), KB_NOTE_URL: 'https://ha/kb/notes/{path}' };

    assert.equal(noteFile(join(dir, 'draft.md'), env, tmp, tmp)?.file.endsWith('scratchpad/draft.md'), true);
    assert.equal(noteFile(join(tmp, 'other.md'), env, tmp, tmp), null);
    assert.equal(noteFile(join(dir, '..', '..', '..', 'other.md'), env, tmp, tmp), null);
    assert.equal(noteUrl(join(dir, 'draft.md'), env, tmp), null);
  } finally {
    rmSync(tmp, { recursive: true });
  }
});
