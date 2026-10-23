import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { noteUrl } from './markdown.ts';

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
    assert.equal(noteUrl('Decisions/Missing.md', env), null);
    assert.equal(noteUrl(join(outside, 'x.md'), env), null);
    assert.equal(noteUrl('../' + outside.split('/').pop() + '/x.md', env), null);
    assert.equal(noteUrl('Decisions/2026-10-23 Shub Device Group.md', { KB_DIR: kb }), null);
  } finally {
    rmSync(kb, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});
