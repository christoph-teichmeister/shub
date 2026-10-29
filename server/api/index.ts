// Owns the HTTP server: Host/Origin guard, auth, routing, JSON errors, event streams, static web app.
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { API_VERSION, ROUTES, type ServerEvent } from '../../shared/api.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import { publicUrl } from '../config/index.ts';
import { refuseLevel } from '../auth/levels.ts';
import { machineName } from '../notify/index.ts';
import { allowList, refuse, type Allowed } from './guard.ts';
import { HttpError, readBody, Router, sendJson, type Caller, type Request } from './router.ts';
import { installUpgrades, keepAlive, onUpgrade } from './upgrade.ts';
import { bundleOffer } from './bundle.ts';

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https: ws: wss:; " +
    "style-src 'self' 'unsafe-inline'; font-src 'self'; " +
    "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Public routes still run handlers with a caller; this one has no rights. */
const ANONYMOUS: Caller = { kind: 'cli', id: 'anonymous', rights: [] };

export function appVersion(appDir: string): string {
  return JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version;
}

/** Which bus events a caller may see: plugin actions go to the user and that plugin, everything else needs `read`. */
export function mayRead(caller: Caller, event: ServerEvent): boolean {
  if (event.type === 'plugin.action') {
    return caller.kind === 'user' || caller.kind === 'cli' || caller.id === `plugin:${event.plugin}`;
  }
  return caller.rights.includes('read');
}

function makeRequest(raw: IncomingMessage, path: string, params: Record<string, string>, caller: Caller): Request {
  let body: Promise<Buffer> | undefined;
  const getBody = (limit?: number) => (body ??= readBody(raw, limit));
  return {
    method: raw.method ?? 'GET',
    path,
    params,
    query: new URL(raw.url ?? '/', 'http://x').searchParams,
    caller,
    raw,
    body: getBody,
    async json<T>() {
      const buf = await getBody();
      if (buf.length === 0) return {} as T;
      try {
        return JSON.parse(buf.toString('utf8')) as T;
      } catch {
        throw new HttpError(400, 'invalid JSON');
      }
    },
  };
}

function eventsRoutes(ctx: Context, router: Router, version: string): void {
  // `machine` names this computer in a phone app that knows several (SHUB_MACHINE_NAME overrides the hostname).
  router.add(ROUTES.health, () => ({ ok: true, version, apiVersion: API_VERSION, machine: machineName() }), {
    public: true,
  });
  // Server-Sent Events twin of the /api/events WebSocket, for plugin languages without a WS client.
  router.add(ROUTES.eventsStream, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const send = (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: 'hello', apiVersion: API_VERSION });
    const off = ctx.bus.on((event) => mayRead(req.caller, event) && send(event));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
  });
}

function attachEventsSocket(ctx: Context, server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  onUpgrade(server, /^\/api\/events$/, (req, socket, head, caller) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'hello', apiVersion: API_VERSION } satisfies ServerEvent));
      const off = ctx.bus.on((event) => mayRead(caller, event) && ws.send(JSON.stringify(event)));
      keepAlive(ws);
      ws.on('close', off);
    });
  });
  server.on('close', () => wss.close());
}

async function serveStatic(distDir: string, path: string, res: ServerResponse): Promise<void> {
  const file = normalize(join(distDir, decodeURIComponent(path)));
  if (file !== distDir && !file.startsWith(distDir + sep)) throw new HttpError(404, 'not found');
  const target = (await stat(file).catch(() => null))?.isFile() ? file : join(distDir, 'index.html');
  const body = await readFile(target).catch(() => null);
  if (!body) throw new HttpError(404, 'web app not built (npm run build)');
  const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
  // Vite puts hashed files under /assets; they never change.
  const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  res.end(body);
}

/**
 * Callable from any origin: another machine's app reads the name (health) and redeems a pairing code before this
 * machine knows its origin. Health is public anyway; the redeem needs the code.
 */
const ANY_ORIGIN_PATHS = new Set([ROUTES.health, ROUTES.pairingRedeem].map((r) => r.split(' ')[1]));

async function handle(
  router: Router,
  services: Services,
  distDir: string,
  allowed: Allowed,
  raw: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const method = raw.method ?? 'GET';
  const path = new URL(raw.url ?? '/', 'http://x').pathname;
  const anyOrigin = ANY_ORIGIN_PATHS.has(path);
  const refusal = refuse(raw, allowed, false, anyOrigin);
  if (refusal) throw new HttpError(403, refusal);
  // A paired phone's app on another machine calls with a Bearer token, never a cookie (no credentials in CORS).
  const origin = raw.headers.origin?.toLowerCase();
  // Also for the static files: another machine's app loader downloads the web app from here.
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
        'access-control-allow-headers': 'authorization, content-type, accept, x-filename',
        'access-control-max-age': '600',
      });
      return void res.end();
    }
  }
  const found = router.match(method, path);
  if (!found) {
    if (path.startsWith('/api/') || (method !== 'GET' && method !== 'HEAD')) throw new HttpError(404, 'not found');
    return serveStatic(distDir, path, res);
  }
  const caller = services.auth.resolve(raw);
  if (!caller && !found.route.public) throw new HttpError(401, 'login required');
  const tooLow = refuseLevel(caller?.level, found.route.spec);
  if (tooLow) throw new HttpError(403, tooLow);
  const result = await found.route.handler(makeRequest(raw, path, found.params, caller ?? ANONYMOUS), res);
  if (res.headersSent) return;
  if (result === undefined) {
    res.writeHead(204);
    res.end();
  } else sendJson(res, 200, result);
}

function sendError(res: ServerResponse, err: unknown): void {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error('shub: request failed', err);
  if (res.headersSent) return void res.destroy();
  sendJson(res, status, { error: status === 500 ? 'internal error' : (err as Error).message });
}

export async function listen(ctx: Context, services: Services, modules: ShubModule[]): Promise<Server> {
  const router = new Router();
  eventsRoutes(ctx, router, appVersion(ctx.paths.appDir));
  router.add(ROUTES.bundle, () => bundleOffer(join(ctx.paths.appDir, 'web', 'dist'), ctx.paths.stateDir), {
    public: true,
  });
  for (const m of modules) m.routes?.(router);

  // Built once and again after what it is made of changes: the public URL (the phone setup sets it while shub runs),
  // the devices' app origins and the group's host URLs.
  let cached: Allowed | undefined;
  const allowed = () => (cached ??= allowList(ctx.port, publicUrl(services.config.get()), services.auth.appOrigins()));
  ctx.bus.on((e) => {
    if (e.type === 'config.changed' || e.type === 'devices.changed') cached = undefined;
  });
  services.group.onChange((key) => {
    if (key.startsWith('device:')) cached = undefined;
  });
  const distDir = join(ctx.paths.appDir, 'web', 'dist');
  const server = createServer((req, res) => {
    handle(router, services, distDir, allowed(), req, res).catch((err) => sendError(res, err));
  });
  installUpgrades(
    server,
    (r) => refuse(r, allowed(), true),
    (r) => services.auth.resolve(r),
  );
  attachEventsSocket(ctx, server);
  for (const m of modules) m.attach?.(server);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(ctx.port, ctx.host, () => resolve());
  });
  return server;
}
