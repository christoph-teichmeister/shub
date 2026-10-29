import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { installUpgrades, keepAlive } from '../api/upgrade.ts';
import type { SessionsService } from './service.ts';
import { attachArgs, attachTerminals, inbound, parseFollow } from './terminal.ts';

test('a malformed terminal URL is a 400 and a failing handler a 500, not a crash', async () => {
  const server = createServer();
  installUpgrades(
    server,
    () => null,
    () => ({ kind: 'user', id: 'chris', rights: [] }),
  );
  const get = (id: string) => {
    if (id === 'boom') throw new Error('tmux failed');
  };
  attachTerminals(server, { get } as unknown as SessionsService);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const status = (path: string) =>
    new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => resolve(0));
    });
  try {
    assert.equal(await status('/api/terminals/%E0%A4%A'), 400);
    assert.equal(await status('/api/terminals/boom'), 500);
    assert.equal(await status('/api/terminals/nope'), 404, 'the server still answers');
  } finally {
    server.close();
  }
});

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

test('keepAlive keeps a socket that answers with pong', async () => {
  const ws: EventEmitter & { dead: boolean; ping(): void; terminate(): void } = Object.assign(new EventEmitter(), {
    dead: false,
    ping() {
      setImmediate(() => ws.emit('pong'));
    },
    terminate() {
      this.dead = true;
    },
  });
  keepAlive(ws as unknown as WebSocket, 10);
  await new Promise((r) => setTimeout(r, 55));
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
