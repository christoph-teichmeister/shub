// End-to-end over HTTP: api + auth + config + state + projects + skills, with a stub permission model.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import type { Right } from '../../shared/api.ts';
import { createContext, type Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import * as state from '../state/index.ts';
import * as config from '../config/index.ts';
import * as auth from '../auth/index.ts';
import * as projects from '../projects/index.ts';
import * as skills from '../skills/index.ts';
import { listen } from './index.ts';

const ALL: Right[] = [
  'read',
  'projects.write',
  'sessions.start',
  'sessions.start.button',
  'sessions.link',
  'buttons.write',
];

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}

let ctx: Context;
let server: Server;
let services: Services;
let base: string;
let accessToken: string;
let cookie = '';
const approvals: unknown[] = [];

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-api-'));
  const port = await freePort();
  ctx = createContext({
    SHUB_CONFIG_DIR: join(root, 'cfg'),
    SHUB_STATE_DIR: join(root, 'state'),
    SHUB_PORT: String(port),
  });
  ctx.paths.appDir = join(root, 'app');
  mkdirSync(join(ctx.paths.appDir, 'web', 'dist', 'assets'), { recursive: true });
  writeFileSync(join(ctx.paths.appDir, 'package.json'), '{"version":"2026.10.0"}');
  writeFileSync(join(ctx.paths.appDir, 'web', 'dist', 'index.html'), '<!doctype html><title>shub</title>');
  writeFileSync(join(ctx.paths.appDir, 'web', 'dist', 'assets', 'app.js'), 'console.log(1)');
  mkdirSync(join(root, 'proj'));

  services = {} as Services;
  services.permissions = {
    rightsFor: (kind: string) => (kind === 'user' || kind === 'cli' ? ALL : ['read']),
    decide: (caller: { kind: string }) =>
      caller.kind === 'user' || caller.kind === 'cli' ? { outcome: 'allow' } : { outcome: 'ask', reason: 'session' },
    requestApproval: (input: object) => {
      const a = { ...input, id: 'a1', createdAt: '', state: 'pending' };
      approvals.push(a);
      return a;
    },
    waitForDecision: () => new Promise(() => {}),
    log: () => ({}),
  } as unknown as Services['permissions'];
  const modules: ShubModule[] = [];
  for (const [key, mod] of [
    ['state', state],
    ['config', config],
    ['auth', auth],
    ['skills', skills],
    [null, projects],
  ] as const) {
    const created = mod.create(ctx, services) as { module: never; service?: never };
    modules.push(created.module);
    if (key) (services as any)[key] = created.service;
  }
  server = await listen(ctx, services, modules);
  base = `http://127.0.0.1:${port}`;
  accessToken = readFileSync(join(ctx.paths.stateDir, 'token'), 'utf8').trim();
  (globalThis as any).projectDir = join(root, 'proj');
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const asUser = (method: string, path: string, body?: unknown) => call(method, path, body, { cookie, origin: base });

test('token file is 0600 and 64 hex chars', () => {
  assert.match(accessToken, /^[0-9a-f]{64}$/);
  assert.equal(statSync(join(ctx.paths.stateDir, 'token')).mode & 0o777, 0o600);
});

test('health is public and reports the version', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, version: '2026.10.0', apiVersion: 1 });
  assert.match(res.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('foreign Host and Origin are refused', async () => {
  // fetch() forbids overriding Host, so use node:http directly.
  const { request } = await import('node:http');
  const status = await new Promise<number>((resolve) => {
    const r = request(base + '/api/health', { headers: { host: 'evil.example:80' } }, (res) =>
      resolve(res.statusCode!),
    );
    r.end();
  });
  assert.equal(status, 403);
  assert.equal(
    (await call('POST', '/api/auth/login', { token: accessToken }, { origin: 'http://evil.example' })).status,
    403,
  );
});

test('login needs the right token and sets a strict cookie', async () => {
  assert.equal((await call('GET', '/api/projects')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { token: 'nope' })).status, 401);
  const res = await call('POST', '/api/auth/login', { token: accessToken, deviceName: 'desk' }, { origin: base });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie')!;
  assert.match(setCookie, /^shub_session=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
  cookie = setCookie.split(';')[0];
  const https = await call('POST', '/api/auth/login', { token: accessToken }, { 'x-forwarded-proto': 'https' });
  assert.match(https.headers.get('set-cookie')!, /; Secure$/);
  const once = await call('POST', '/api/auth/login', { token: accessToken, remember: false });
  assert.match(once.headers.get('set-cookie')!, /^shub_session=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/$/);
});

test('cookie requests that change state need an Origin', async () => {
  assert.equal((await call('POST', '/api/projects/reorder', { ids: [] }, { cookie })).status, 403);
  assert.equal((await asUser('POST', '/api/projects/reorder', { ids: [] })).status, 200);
});

test('folders: lists subfolders for the picker, user only', async () => {
  const path = (globalThis as any).projectDir;
  mkdirSync(join(path, 'sub'), { recursive: true });
  mkdirSync(join(path, '.hidden'), { recursive: true });
  const res = await asUser('GET', `/api/folders?path=${encodeURIComponent(path)}`);
  assert.deepEqual(await res.json(), { path, parent: dirname(path), folders: ['sub'] });
  assert.equal((await asUser('GET', '/api/folders?path=relative')).status, 400);
  assert.equal((await call('GET', '/api/folders')).status, 401);
});

test('projects: create, update, reorder, delete', async () => {
  const path = (globalThis as any).projectDir;
  const created = await asUser('POST', '/api/projects', { name: 'My Proj', path, group: 'Private' });
  assert.equal(created.status, 200);
  const view = await created.json();
  assert.equal(view.id, 'my-proj');
  assert.equal(view.accent, '#f92672');
  assert.equal((await asUser('POST', '/api/projects', { name: 'dup', path })).status, 409);
  assert.equal((await asUser('POST', '/api/projects', { name: 'x', path: 'relative' })).status, 400);
  const url = 'https://example.com/logo.png';
  const withUrl = await asUser('PATCH', '/api/projects/my-proj', { icon: { kind: 'image', path: url } });
  assert.equal((await withUrl.json()).resolvedIcon.path, url);
  for (const bad of ['http://example.com/a.png', 'javascript:alert(1)', '/etc/passwd'])
    assert.equal((await asUser('PATCH', '/api/projects/my-proj', { icon: { kind: 'image', path: bad } })).status, 400);
  const updated = await asUser('PATCH', '/api/projects/my-proj', { visibility: 'dormant' });
  assert.equal((await updated.json()).visibility, 'dormant');
  const configRes = await (await asUser('GET', '/api/config')).json();
  assert.deepEqual(configRes.groups, ['Private']);
  assert.equal((await asUser('DELETE', '/api/projects/my-proj')).status, 200);
  assert.deepEqual(await (await asUser('GET', '/api/projects')).json(), []);
  assert.ok(statSync(path).isDirectory());
});

test('client tokens: sessions get read access and approvals for writes', async () => {
  const token = services.auth.issueClientToken({ kind: 'session', id: 'session:s1', rights: [] });
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await call('GET', '/api/projects', undefined, headers)).status, 200);
  const res = await call('POST', '/api/projects', { name: 'p', path: (globalThis as any).projectDir }, headers);
  assert.equal((await res.json()).approval.requestedBy, 'session:s1');
  assert.equal((await call('GET', '/api/devices', undefined, headers)).status, 403);
  services.auth.revokeClientToken(token);
  assert.equal((await call('GET', '/api/projects', undefined, headers)).status, 401);
});

test('settings and themes', async () => {
  assert.equal((await asUser('PATCH', '/api/settings', { activeTheme: 'nope' })).status, 400);
  assert.equal((await asUser('PUT', '/api/themes/monokai', { name: 'x', tokens: {} })).status, 400);
  assert.equal(
    (await asUser('PUT', '/api/themes/mine', { name: 'Mine', base: 'monokai', tokens: { bg: '#000' } })).status,
    200,
  );
  const config = await (
    await asUser('PATCH', '/api/settings', { activeTheme: 'mine', notifications: { pushYourTurn: true } })
  ).json();
  assert.equal(config.activeTheme, 'mine');
  assert.equal(config.notifications.pushYourTurn, true);
});

test('pairing: single use code creates a phone device', async () => {
  const start = await (await asUser('POST', '/api/auth/pairing')).json();
  assert.equal(start.url, `http://127.0.0.1:${ctx.port}/pair/${start.code}`);
  assert.match(start.qrSvg, /^<svg/);
  const redeem = await call('POST', '/api/auth/pairing/redeem', { code: start.code, deviceName: 'phone' });
  assert.equal(redeem.status, 200);
  assert.equal((await redeem.json()).device.kind, 'phone');
  assert.equal((await call('POST', '/api/auth/pairing/redeem', { code: start.code })).status, 401);
  const devices = await (await asUser('GET', '/api/devices')).json();
  assert.ok(devices.some((d: { kind: string }) => d.kind === 'phone'));
});

test('events WebSocket says hello and forwards bus events; needs Origin with a cookie', async () => {
  const wsUrl = base.replace('http', 'ws') + '/api/events';
  const noOrigin = new WebSocket(wsUrl, { headers: { cookie } });
  await new Promise<void>((resolve) => noOrigin.on('error', () => resolve()));
  const ws = new WebSocket(wsUrl, { headers: { cookie, origin: base } });
  const messages: { type: string }[] = [];
  await new Promise<void>((resolve) =>
    ws.on('message', (data) => {
      messages.push(JSON.parse(String(data)));
      if (messages.length === 1) ctx.bus.emit({ type: 'plugins.changed' });
      if (messages.length === 2) resolve();
    }),
  );
  assert.deepEqual(
    messages.map((m) => m.type),
    ['hello', 'plugins.changed'],
  );
  ws.close();
});

test('events SSE stream', async () => {
  const controller = new AbortController();
  const res = await fetch(base + '/api/events/stream', { headers: { cookie }, signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.equal(first, 'data: {"type":"hello","apiVersion":1}\n\n');
  controller.abort();
});

test('static files with SPA fallback; unknown api paths are JSON 404', async () => {
  const js = await call('GET', '/assets/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const spa = await call('GET', '/pair/abc');
  assert.match(await spa.text(), /<title>shub/);
  assert.equal((await call('GET', '/..%2fpackage.json')).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('rotate signs out other devices but keeps the caller', async () => {
  const other = await call('POST', '/api/auth/login', { token: accessToken });
  const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
  const rotated = await asUser('POST', '/api/auth/rotate');
  assert.equal(rotated.status, 200);
  assert.equal(rotated.headers.get('cache-control'), 'no-store');
  const { token } = (await rotated.json()) as { token: string };
  assert.equal(token, readFileSync(join(ctx.paths.stateDir, 'token'), 'utf8').trim(), 'new token, shown once');
  assert.equal((await call('GET', '/api/auth/me', undefined, { cookie: otherCookie })).status, 401);
  const me = await asUser('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.ok(!(await me.text()).includes(token), 'not retrievable later');
  assert.equal((await call('POST', '/api/auth/login', { token: accessToken })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { token })).status, 200);
});
