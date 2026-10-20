import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../api/router.ts';
import { Tmux, TMUX_MISSING } from './tmux.ts';

test('a missing tmux is a clear 503, not an internal error', (t) => {
  const path = process.env.PATH;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'shub-no-tmux-'));
  t.after(() => void (process.env.PATH = path));
  const tmux = new Tmux('shub-test-missing', join(process.env.PATH, 'tmux.conf'));
  assert.throws(
    () => tmux.newSession('x', '/', {}, ['true']),
    (err) => err instanceof HttpError && err.status === 503 && err.message === TMUX_MISSING,
  );
  assert.deepEqual(tmux.sessions(), new Set());
});
