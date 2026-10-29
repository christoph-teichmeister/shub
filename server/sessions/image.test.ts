import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sendImage, viewableImage } from './image.ts';

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
    mkdirSync(join(claude, 'folder.png'));
    assert.equal(viewableImage(join(claude, 'folder.png'), state), null, 'a folder named like an image');
    assert.equal(viewableImage('a.png', state), null, 'relative path');
  } finally {
    for (const d of [claude, other, state]) rmSync(d, { recursive: true, force: true });
  }
});

test('sendImage streams the file, and a file gone since the check only aborts that response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-test-'));
  let file = join(dir, 'a.png');
  const server = createServer((_req, res) => sendImage(res, { file, type: 'image/png' }));
  try {
    writeFileSync(join(dir, 'a.png'), 'png bytes');
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    assert.equal(await (await fetch(url)).text(), 'png bytes');
    file = join(dir, 'gone.png');
    await assert.rejects(fetch(url).then((r) => r.text()));
    file = join(dir, 'a.png');
    assert.equal((await fetch(url)).status, 200, 'the server is still up');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
