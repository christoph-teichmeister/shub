import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { keepAlive } from '../api/upgrade.ts';
import { attachArgs, parseFollow } from './terminal.ts';

test('only a follow client attaches with ignore-size', () => {
  assert.deepEqual(attachArgs('s', 'n', false), ['-L', 's', 'attach-session', '-t', '=n']);
  assert.deepEqual(attachArgs('s', 'n', true), ['-L', 's', 'attach-session', '-f', 'ignore-size', '-t', '=n']);
});

test('follow is on only for follow=1', () => {
  assert.equal(parseFollow(new URLSearchParams('follow=1&cols=40')), true);
  assert.equal(parseFollow(new URLSearchParams('follow=true')), false);
  assert.equal(parseFollow(new URLSearchParams('')), false);
});

test('keepAlive terminates a socket that missed a pong', async () => {
  const ws = Object.assign(new EventEmitter(), {
    pings: 0,
    dead: false,
    ping() {
      this.pings++;
    },
    terminate() {
      this.dead = true;
    },
  });
  keepAlive(ws as unknown as WebSocket, 10);
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(ws.pings, 1);
  assert.equal(ws.dead, true);
  ws.emit('close');
});
