// WebSocket upgrade dispatcher.
//
// Node emits every upgrade on one 'upgrade' event, so several modules each listening on it would
// fight over sockets. Instead the api module installs exactly one listener per server (installUpgrades),
// which checks Host/Origin, resolves the caller and hands the socket to the handler registered for the path.
// Modules register in their `attach(server)` hook:
//
//   attach(server) {
//     onUpgrade(server, /^\/api\/terminals\/([^/]+)$/, (req, socket, head, caller, match) => { ... });
//   }
//
// The handler gets an authenticated caller; it must take over the socket (e.g. wss.handleUpgrade) or
// destroy it. Unknown paths get 404, unauthenticated requests 401.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Caller } from './router.ts';

export type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  caller: Caller,
  match: RegExpExecArray,
) => void;

interface Entry {
  path: RegExp;
  handler: UpgradeHandler;
}

const registries = new WeakMap<Server, Entry[]>();

function entries(server: Server): Entry[] {
  let list = registries.get(server);
  if (!list) registries.set(server, (list = []));
  return list;
}

export function onUpgrade(server: Server, path: RegExp, handler: UpgradeHandler): void {
  entries(server).push({ path, handler });
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function installUpgrades(
  server: Server,
  check: (req: IncomingMessage) => string | null,
  resolve: (req: IncomingMessage) => Caller | null,
): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    if (check(req)) return reject(socket, 403, 'Forbidden');
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    for (const entry of entries(server)) {
      const match = entry.path.exec(path);
      if (!match) continue;
      const caller = resolve(req);
      if (!caller) return reject(socket, 401, 'Unauthorized');
      return entry.handler(req, socket, head, caller, match);
    }
    reject(socket, 404, 'Not Found');
  });
}
