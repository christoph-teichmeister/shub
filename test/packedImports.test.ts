import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The folders pack() in scripts/release/release.ts puts in the archive. An import that leaves them works in the
// repo (tests, typecheck) but crashes the installed app, which only the post-merge release dry run would show.
const PACKED = ['server', 'shared', 'cli'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPECIFIER = /(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

test('packed code imports only from packed folders', () => {
  const escapes: string[] = [];
  for (const dir of PACKED)
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      const file = join(entry.parentPath, entry.name);
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const top = relative(ROOT, join(dirname(file), spec)).split(sep)[0];
        if (!PACKED.includes(top)) escapes.push(`${relative(ROOT, file)} -> ${spec}`);
      }
    }
  assert.deepEqual(escapes, []);
});
