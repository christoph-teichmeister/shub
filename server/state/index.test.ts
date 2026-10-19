import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openState } from './index.ts';

test('migrate runs each statement once, also across reopen', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'shub-state-')), 'state');
  const state = openState(dir);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  const steps = ['CREATE TABLE t (a INTEGER)', 'INSERT INTO t VALUES (1)'];
  state.migrate('demo', steps);
  state.migrate('demo', steps);
  state.db.close();
  const again = openState(dir);
  again.migrate('demo', [...steps, 'INSERT INTO t VALUES (2)']);
  assert.deepEqual(
    again.db
      .prepare('SELECT a FROM t ORDER BY a')
      .all()
      .map((r) => r.a),
    [1, 2],
  );
});
