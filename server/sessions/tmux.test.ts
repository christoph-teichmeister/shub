import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../api/router.ts';
import { spawn } from 'node-pty';
import { Tmux, TMUX_MISSING } from './tmux.ts';
import { attachArgs } from './terminal.ts';

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

test('OSC 8 links reach an attached xterm client', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shub-osc8-'));
  const tmux = new Tmux(`shub-test-osc8-${process.pid}`, join(dir, 'tmux.conf'));
  t.after(() => tmux.killServer());
  // Without the hyperlinks terminal feature tmux drops the link and only "link" text arrives (clicks did nothing).
  const printLink = String.raw`printf '\033]8;;https://example.com\033\\link\033]8;;\033\\\n'; sleep 30`;
  tmux.newSession('osc8', dir, {}, ['sh', '-c', printLink]);
  const client = spawn('tmux', attachArgs(tmux.socket, 'osc8', false), {
    cols: 80,
    rows: 24,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });
  t.after(() => client.kill());
  let out = '';
  client.onData((d) => (out += d));
  const until = Date.now() + 5000;
  while (!out.includes('\x1b]8;') && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  assert.ok(out.includes('\x1b]8;'), `no OSC 8 in client output: ${JSON.stringify(out)}`);
});
