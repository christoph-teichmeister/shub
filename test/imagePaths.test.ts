import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allImagePaths,
  imagePathsAt,
  NOTE_PATH,
  type Buffer,
} from '../web/src/lib/components/TerminalView/imagePaths.ts';

/** A fake xterm buffer `cols` wide; a row starting with `\u0001` is soft-wrapped; `😀` takes two cells. */
function buffer(cols: number, rows: string[]): Buffer {
  const lines = rows.map((raw) => {
    const isWrapped = raw.startsWith('\u0001');
    const cells: { chars: string; width: number }[] = [];
    for (const ch of isWrapped ? raw.slice(1) : raw) {
      if (ch === '😀') cells.push({ chars: ch, width: 2 }, { chars: '', width: 0 });
      else cells.push({ chars: ch, width: 1 });
    }
    while (cells.length < cols) cells.push({ chars: '', width: 1 });
    return {
      isWrapped,
      length: cols,
      getCell: (x: number) => ({ getChars: () => cells[x].chars, getWidth: () => cells[x].width }),
    };
  });
  return { length: lines.length, getLine: (y) => lines[y] };
}

test('an image path on one row', () => {
  const buf = buffer(40, ['see /tmp/claude-x/a.png now']);
  assert.deepEqual(imagePathsAt(buf, 0), [
    { path: '/tmp/claude-x/a.png', start: { x: 5, y: 1 }, end: { x: 23, y: 1 } },
  ]);
});

test('a path xterm wrapped over two rows is one link on both rows', () => {
  const buf = buffer(12, ['- /tmp/claud', '\u0001e-x/a.png ok']);
  const link = { path: '/tmp/claude-x/a.png', start: { x: 3, y: 1 }, end: { x: 9, y: 2 } };
  assert.deepEqual(imagePathsAt(buf, 0), [link]);
  assert.deepEqual(imagePathsAt(buf, 1), [link]);
});

test("a path Claude broke at the last column goes on after the next row's indent", () => {
  const buf = buffer(12, ['- /tmp/claud', '  e-x/a.png', 'next']);
  assert.deepEqual(imagePathsAt(buf, 1), [
    { path: '/tmp/claude-x/a.png', start: { x: 3, y: 1 }, end: { x: 11, y: 2 } },
  ]);
});

test('a row ending in blank cells does not join the next one', () => {
  const buf = buffer(20, ['- /tmp/claud', '/x/a.png']);
  assert.deepEqual(
    imagePathsAt(buf, 1).map((p) => p.path),
    ['/x/a.png'],
  );
});

test('a wide character before the path keeps the columns right', () => {
  const buf = buffer(30, ['😀 /tmp/claude-x/a.png']);
  assert.deepEqual(imagePathsAt(buf, 0)[0].start, { x: 4, y: 1 });
});

test('allImagePaths lists each path once, wrapped ones too', () => {
  const buf = buffer(12, ['- /tmp/claud', '\u0001e-x/a.png ok', '/x/b.jpg', '/x/b.jpg']);
  assert.deepEqual(allImagePaths(buf), ['/tmp/claude-x/a.png', '/x/b.jpg']);
});

test('NOTE_PATH finds note paths with spaces in the file name only', () => {
  const line =
    'Design note: Decisions/2026-10-23 Shub Device Group.md. See docs/SECURITY.md and ~/a/b.md, not plain.md';
  const buf = buffer(120, [line]);
  assert.deepEqual(
    imagePathsAt(buf, 0, NOTE_PATH).map((p) => p.path),
    ['Decisions/2026-10-23 Shub Device Group.md', 'docs/SECURITY.md', '~/a/b.md'],
  );
});
