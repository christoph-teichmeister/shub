import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneOptions, cloneRepo } from './clone.ts';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'shub-clone-'));
  mkdirSync(join(root, 'private'));
  mkdirSync(join(root, '.hidden'));
  return root;
}

test('folders list the root subfolders, not hidden ones', async () => {
  const o = await cloneOptions(setup(), null);
  assert.deepEqual(o.folders, ['private']);
});

test('clone rejects bad input', async () => {
  const root = setup();
  await assert.rejects(cloneRepo(root, { url: '--upload-pack=x', folder: 'private' }), /url must be/);
  await assert.rejects(cloneRepo(root, { url: 'https://x.test/a/b.git', folder: '../etc' }), /subfolder/);
  await assert.rejects(cloneRepo(root, { url: 'https://x.test/a/b.git', folder: 'private', name: '..' }), /name may/);
  mkdirSync(join(root, 'private', 'b'));
  await assert.rejects(cloneRepo(root, { url: 'https://x.test/a/b.git', folder: 'private' }), /already exists/);
});

test('a failing clone surfaces as an error', async () => {
  await assert.rejects(cloneRepo(setup(), { url: 'ssh://127.0.0.1:1/none', folder: 'private' }), /git clone failed/);
});
