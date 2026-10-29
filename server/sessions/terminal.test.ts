import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { keepAlive } from '../api/upgrade.ts';
import { attachArgs, inbound, parseFollow } from './terminal.ts';

test('only a follow client attaches with ignore-size', () => {
  assert.deepEqual(attachArgs('s', 'n', false), ['-L', 's', 'attach-session', '-t', '=n']);
  assert.deepEqual(attachArgs('s', 'n', true), ['-L', 's', 'attach-session', '-f', 'ignore-size', '-t', '=n']);
});

test('follow is on only for follow=1', () => {
  assert.equal(parseFollow(new URLSearchParams('follow=1&cols=40')), true);
  assert.equal(parseFollow(new URLSearchParams('follow=true')), false);
  assert.equal(parseFollow(new URLSearchParams('')), false);
});

test('keepAlive terminates a socket that missed a pong', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
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
  t.after(() => ws.emit('close')); // clears the interval even when an assertion fails
  t.mock.timers.tick(10);
  assert.equal(ws.pings, 1);
  assert.equal(ws.dead, false);
  t.mock.timers.tick(10);
  assert.equal(ws.dead, true);
});

test('keepAlive keeps a socket that answers with pong', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ws: EventEmitter & { pings: number; dead: boolean; ping(): void; terminate(): void } = Object.assign(
    new EventEmitter(),
    {
      pings: 0,
      dead: false,
      ping() {
        this.pings++;
        ws.emit('pong');
      },
      terminate() {
        this.dead = true;
      },
    },
  );
  keepAlive(ws as unknown as WebSocket, 10);
  t.after(() => ws.emit('close'));
  t.mock.timers.tick(50);
  assert.equal(ws.pings, 5);
  assert.equal(ws.dead, false);
  ws.emit('close');
  assert.equal(ws.listenerCount('pong'), 1); // only the handler; the timer is cleared by close
});

test('inbound: a follower ignores resizes, a watcher cannot type', () => {
  const calls: string[] = [];
  const pty = {
    resize: (c: number, r: number) => calls.push(`resize ${c}x${r}`),
    write: (d: string) => calls.push(`write ${d}`),
  };
  const resize = '\u0000' + JSON.stringify({ type: 'resize', cols: 50, rows: 20 });
  inbound(resize, false, { follow: true, typing: true }, pty);
  inbound(resize, false, { follow: false, typing: false }, pty);
  inbound('x', false, { follow: false, typing: false }, pty);
  assert.deepEqual(calls, ['resize 50x20']);
  inbound('y', false, { follow: true, typing: true }, pty);
  assert.deepEqual(calls, ['resize 50x20', 'write y']);
});
