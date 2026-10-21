import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSprites } from './sprites.ts';

const COMMITTED = fileURLToPath(new URL('../../web/public/village/', import.meta.url));

const read = (dir: string) =>
  new Map(
    readdirSync(dir)
      .sort()
      .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
  );

test('sprites are deterministic and match the committed web/public/village/', () => {
  const a = mkdtempSync(join(tmpdir(), 'village-a-'));
  const b = mkdtempSync(join(tmpdir(), 'village-b-'));
  writeSprites(a);
  writeSprites(b);
  const first = read(a);
  assert.deepEqual(read(b), first);
  assert.deepEqual(
    read(COMMITTED),
    first,
    'web/public/village/ is stale: run node scripts/village/sprites.ts and commit the result',
  );
  for (const [name, svg] of first) assert.ok(svg.length < 600_000, `${name} is ${svg.length} bytes`);
});
