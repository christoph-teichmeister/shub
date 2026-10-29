// End-to-end over HTTP: api + auth + config + state + projects + skills, with a stub permission model.
import { hostname } from 'node:os';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { WebSocket } from 'ws';
import type { Right } from '../../shared/api.ts';
import { createContext, type Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import * as state from '../state/index.ts';
import * as config from '../config/index.ts';
import * as group from '../group/index.ts';
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
let userToken = ''; // the host's own browser, signed in by key
let userDeviceId = '';
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
    ['group', group],
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

const asUser = (method: string, path: string, body?: unknown) =>
  call(method, path, body, { authorization: `Bearer ${userToken}` });

/** Signs a challenge with the device's key, as a browser does, and returns its short-lived token. */
async function signInWith(deviceId: string, privateKey: KeyObject): Promise<string> {
  const { nonce } = await (await call('POST', '/api/auth/challenge', { deviceId })).json();
  const signature = sign('sha256', Buffer.from(`shub-login:${nonce}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const res = await call('POST', '/api/auth/session', { deviceId, nonce, signature });
  assert.equal(res.status, 200);
  return (await res.json()).token as string;
}

/** The first browser on the host: bootstraps with the access token and a key of its own. */
async function bootstrapBrowser(name: string, token = accessToken) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const res = await call('POST', '/api/auth/bootstrap', {
    token,
    deviceName: name,
    publicKey: publicKey.export({ format: 'jwk' }),
  });
  return { res, privateKey };
}

test('token file is 0600 and 64 hex chars', () => {
  assert.match(accessToken, /^[0-9a-f]{64}$/);
  assert.equal(statSync(join(ctx.paths.stateDir, 'token')).mode & 0o777, 0o600);
});

test('health is public and reports the version', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, version: '2026.10.0', apiVersion: 1, machine: hostname() });
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
    (await call('POST', '/api/auth/bootstrap', { token: accessToken }, { origin: 'http://evil.example' })).status,
    403,
  );
});

test('bootstrap: the first browser on the host joins with the access token and its own key', async () => {
  assert.equal((await call('GET', '/api/projects')).status, 401);
  assert.equal((await bootstrapBrowser('desk', 'nope')).res.status, 401);
  assert.equal((await call('POST', '/api/auth/bootstrap', { token: accessToken, publicKey: {} })).status, 400);
  const { res, privateKey } = await bootstrapBrowser('desk');
  assert.equal(res.status, 200);
  const { device } = await res.json();
  assert.equal(device.kind, 'desktop');
  assert.equal(device.state, 'active');
  assert.equal(device.level, 'control');
  assert.ok(!res.headers.get('set-cookie'), 'no cookie login any more');
  userDeviceId = device.id;
  userToken = await signInWith(device.id, privateKey);
  const me = await (await asUser('GET', '/api/auth/me')).json();
  assert.equal(me.caller.deviceId, device.id);
  assert.equal(me.local, true, 'the host browser approves on the machine');
});

test('a cookie no longer signs in', async () => {
  const cookie = 'shub_session=abc';
  assert.equal((await call('GET', '/api/projects', undefined, { cookie, origin: base })).status, 401);
});

test('cookie rows from before key sign-in are dropped on start', () => {
  const svc = services.auth as unknown as auth.AuthService;
  services.state.db
    .prepare(
      `INSERT INTO devices (id, name, kind, session_hash, paired_at, last_seen_at) VALUES ('old', 'old', 'desktop', 'h', '', '')`,
    )
    .run();
  svc.dropCookieDevices();
  assert.deepEqual(
    svc.devices().map((d) => d.id),
    [userDeviceId],
  );
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

test('projects: create: true makes a missing folder with git init, after the gate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-create-'));
  const path = join(root, 'a', 'new-repo');
  assert.equal((await asUser('POST', '/api/projects', { name: 'Nope', path })).status, 400);
  assert.equal((await asUser('POST', '/api/projects', { name: 'Bad', path, create: 'yes' })).status, 400);
  const file = join(root, 'file');
  writeFileSync(file, '');
  assert.equal((await asUser('POST', '/api/projects', { name: 'File', path: file, create: true })).status, 400);
  assert.equal((await asUser('POST', '/api/projects', { name: 'Rel', path: 'rel/x', create: true })).status, 400);

  // A session caller only gets an approval; nothing is created before it is decided.
  const token = services.auth.issueClientToken({ kind: 'session', id: 'session:s2', rights: [] });
  const asked = await call(
    'POST',
    '/api/projects',
    { name: 'New', path, create: true },
    { authorization: `Bearer ${token}` },
  );
  assert.ok((await asked.json()).approval);
  assert.equal(statSync(path, { throwIfNoEntry: false }), undefined);
  services.auth.revokeClientToken(token);

  const created = await asUser('POST', '/api/projects', { name: 'New', path, create: true });
  assert.equal(created.status, 200);
  assert.ok(statSync(join(path, '.git')).isDirectory());
  // An existing folder is taken as it is.
  const kept = join(root, 'kept');
  mkdirSync(kept);
  assert.equal((await asUser('POST', '/api/projects', { name: 'Kept', path: kept, create: true })).status, 200);
  assert.equal(statSync(join(kept, '.git'), { throwIfNoEntry: false }), undefined);
  for (const id of ['new', 'kept']) await asUser('DELETE', `/api/projects/${id}`);
  rmSync(root, { recursive: true, force: true });
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
  assert.equal((await asUser('PATCH', '/api/settings', { sync: { nope: true } })).status, 400);
  assert.equal((await asUser('PATCH', '/api/settings', { sync: { pluginEnv: 'yes' } })).status, 400);
  assert.deepEqual((await (await asUser('PATCH', '/api/settings', { sync: { themes: false } })).json()).sync, {
    themes: false,
  });
  assert.equal((await asUser('PATCH', '/api/settings', { activeGroup: 'yes' })).status, 400);
  assert.equal((await (await asUser('PATCH', '/api/settings', { activeGroup: true })).json()).activeGroup, true);
  assert.equal((await asUser('PATCH', '/api/settings', { terminal: { fontSize: 200 } })).status, 400);
  assert.equal((await asUser('PATCH', '/api/settings', { terminal: { fontFamily: 'x; color: red' } })).status, 400);
  assert.equal((await asUser('PATCH', '/api/settings', { terminal: { colour: 'red' } })).status, 400);
  assert.equal((await asUser('PATCH', '/api/settings', { terminal: { fallbackFont: '' } })).status, 400);
  await asUser('PATCH', '/api/settings', { terminal: { fontSize: 15 } });
  const terminal = (await (await asUser('PATCH', '/api/settings', { terminal: { cursorStyle: 'bar' } })).json())
    .terminal;
  assert.deepEqual(terminal, { fontSize: 15, cursorStyle: 'bar' });
  const reset = (await (await asUser('PATCH', '/api/settings', { terminal: { fontSize: null } })).json()).terminal;
  assert.deepEqual(reset, { cursorStyle: 'bar' });
});

test('pairing: a phone pairs with its key, waits for approval and then signs in by challenge', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const start = await (await asUser('POST', '/api/auth/pairing')).json();
  assert.equal(start.url, `http://127.0.0.1:${ctx.port}/pair/${start.code}`);
  assert.match(start.qrSvg, /^<svg/);
  const redeem = await call('POST', '/api/auth/pairing/redeem', {
    code: start.code,
    deviceName: 'phone',
    publicKey: publicKey.export({ format: 'jwk' }),
  });
  assert.equal(redeem.status, 200);
  const { device } = await redeem.json();
  assert.equal(device.kind, 'phone');
  assert.equal(device.state, 'pending');
  assert.equal((await call('POST', '/api/auth/pairing/redeem', { code: start.code })).status, 400);
  assert.equal((await call('POST', '/api/auth/challenge', { deviceId: device.id })).status, 409);

  // Approved in shub on the machine (loopback, signed in with the access token).
  assert.equal((await asUser('POST', `/api/devices/${device.id}/approve`)).status, 200);
  const token = await signInWith(device.id, privateKey);
  const asPhone = (method: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // Prompts (the level of a new phone): reads, but no settings, no new pairings and no raising itself.
  assert.equal((await asPhone('GET', '/api/devices')).status, 200);
  assert.equal((await asPhone('PATCH', '/api/settings', { terminal: { fontSize: 15 } })).status, 403);
  assert.equal((await asPhone('POST', '/api/auth/pairing')).status, 403);
  assert.equal((await asPhone('PATCH', `/api/devices/${device.id}`, { level: 'control' })).status, 403);
  assert.equal((await asPhone('POST', `/api/devices/${device.id}/approve`)).status, 403);

  // The events WebSocket takes the token as a subprotocol.
  const ws = new WebSocket(base.replace('http', 'ws') + '/api/events', ['shub', `bearer.${token}`]);
  const hello = await new Promise<string>((resolve) => ws.on('message', (data) => resolve(String(data))));
  assert.match(hello, /hello/);
  const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));

  // Removing the device ends its socket and its token at once.
  assert.equal((await asUser('DELETE', `/api/devices/${device.id}`)).status, 200);
  await closed;
  assert.equal((await asPhone('GET', '/api/devices')).status, 401);
});

test('pairing: a second browser pairs with a code, is approved on the host, and pairs again after losing its key', async () => {
  const pair = async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const { code } = await (await asUser('POST', '/api/auth/pairing')).json();
    const res = await call('POST', '/api/auth/pairing/redeem', {
      code,
      deviceName: 'laptop',
      kind: 'browser',
      publicKey: publicKey.export({ format: 'jwk' }),
    });
    assert.equal(res.status, 200);
    const { device } = await res.json();
    assert.equal(device.kind, 'browser');
    assert.equal(device.state, 'pending');
    return { device, privateKey };
  };
  const first = await pair();
  assert.equal((await call('POST', '/api/auth/challenge', { deviceId: first.device.id })).status, 409);
  assert.equal((await asUser('POST', `/api/devices/${first.device.id}/approve`)).status, 200);
  const laptop = await signInWith(first.device.id, first.privateKey);
  const asLaptop = (method: string, path: string) =>
    call(method, path, undefined, { authorization: `Bearer ${laptop}` });
  assert.equal((await asLaptop('GET', '/api/projects')).status, 200, 'control: a browser works like the host one');
  // Not the host's own browser: no approving, even through loopback.
  const second = await pair();
  assert.equal((await asLaptop('POST', `/api/devices/${second.device.id}/approve`)).status, 403);
  assert.equal(((await (await asLaptop('GET', '/api/auth/me')).json()) as { local: boolean }).local, false);

  // Site data cleared: the key is gone. Its entry is removed by a trusted device, and the browser pairs again.
  assert.equal((await asUser('DELETE', `/api/devices/${first.device.id}`)).status, 200);
  assert.equal((await asUser('DELETE', `/api/devices/${second.device.id}`)).status, 200);
  assert.equal((await call('POST', '/api/auth/challenge', { deviceId: first.device.id })).status, 404);
  assert.equal((await asLaptop('GET', '/api/projects')).status, 401);
  const again = await pair();
  assert.equal((await asUser('POST', `/api/devices/${again.device.id}/approve`)).status, 200);
  assert.equal((await asUser('DELETE', `/api/devices/${again.device.id}`)).status, 200);
});

test('a Control phone makes codes and approves, no device raises itself, any trusted device revokes', async () => {
  const pairPhone = async (name: string, code: string) => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const res = await call('POST', '/api/auth/pairing/redeem', {
      code,
      deviceName: name,
      publicKey: publicKey.export({ format: 'jwk' }),
    });
    assert.equal(res.status, 200);
    return { device: (await res.json()).device, privateKey };
  };
  const as = (token: string) => (method: string, path: string, body?: unknown) =>
    call(method, path, body, { authorization: `Bearer ${token}` });

  const a = await pairPhone('phone A', (await (await asUser('POST', '/api/auth/pairing')).json()).code);
  assert.equal((await asUser('POST', `/api/devices/${a.device.id}/approve`)).status, 200);
  const asA = as(await signInWith(a.device.id, a.privateKey));
  assert.equal((await asA('POST', '/api/auth/pairing')).status, 403, 'Prompts: no codes yet');
  assert.equal((await asUser('PATCH', `/api/devices/${a.device.id}`, { level: 'control' })).status, 200);

  // A phone at Control makes the code; the new device names the host that made it.
  const { code } = await (await asA('POST', '/api/auth/pairing')).json();
  const b = await pairPhone('phone B', code);
  assert.equal(b.device.state, 'pending');
  assert.equal(b.device.host, process.env.SHUB_MACHINE_NAME || hostname());
  assert.equal((await asA('POST', `/api/devices/${b.device.id}/approve`)).status, 400, 'the dialog confirms first');
  assert.equal((await asA('POST', `/api/devices/${b.device.id}/approve`, { confirm: true })).status, 200);
  const asB = as(await signInWith(b.device.id, b.privateKey));
  assert.equal(b.device.level, 'prompts');

  // Nobody raises itself; a Prompts phone raises nobody; a Control phone raises another device.
  assert.equal((await asA('PATCH', `/api/devices/${a.device.id}`, { level: 'view' })).status, 403);
  assert.equal((await asB('PATCH', `/api/devices/${b.device.id}`, { level: 'control' })).status, 403);
  assert.equal((await asA('PATCH', `/api/devices/${b.device.id}`, { level: 'control' })).status, 200);

  // Any trusted device revokes, even one at Prompts: A is gone at once.
  assert.equal((await asB('DELETE', `/api/devices/${a.device.id}`)).status, 200);
  assert.equal((await asA('GET', '/api/devices')).status, 401);
  assert.equal((await asUser('DELETE', `/api/devices/${b.device.id}`)).status, 200);
});

test("another machine's app pairs cross-origin with a short code and may call this machine afterwards", async () => {
  const app = 'https://other-machine.example.ts.net';
  const foreign = (method: string, path: string, origin: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await foreign('GET', '/api/devices', app)).status, 403);
  // Health is open to any origin: an app reads the machine's name before pairing.
  assert.equal((await foreign('GET', '/api/health', app)).status, 200);

  const { code } = await (await asUser('POST', '/api/auth/pairing')).json();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  const preflight = await foreign('OPTIONS', '/api/auth/pairing/redeem', app);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), app);
  // Typed by hand: lower case with a dash is the same code.
  const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const redeem = await foreign('POST', '/api/auth/pairing/redeem', app, {
    code: typed,
    deviceName: 'Pixel',
    publicKey: publicKey.export({ format: 'jwk' }),
  });
  assert.equal(redeem.status, 200);
  assert.equal(redeem.headers.get('access-control-allow-origin'), app);

  // Now the app's origin is known: CORS answers, a third origin still does not.
  const health = await foreign('GET', '/api/health', app);
  assert.equal(health.headers.get('access-control-allow-origin'), app);
  assert.equal(typeof (await health.json()).machine, 'string');
  // Other routes now answer the app's origin (401 without a token, not 403), a third origin still gets 403.
  assert.equal((await foreign('GET', '/api/devices', app)).status, 401);
  assert.equal((await foreign('GET', '/api/devices', 'https://evil.example')).status, 403);
});

test('the bundle offer: 404 in a dev build, else the manifest with its release SUMS and signature', async () => {
  assert.equal((await call('GET', '/api/bundle')).status, 404);
  const dist = join(ctx.paths.appDir, 'web', 'dist');
  const manifest = '{"version":"2026.10.9","apiVersion":1,"files":{"/index.html":"' + 'a'.repeat(64) + '"}}';
  writeFileSync(join(dist, 'bundle.json'), manifest);
  // Cached as if fetched from the GitHub release once.
  const release = join(ctx.paths.stateDir, 'release', '2026.10.9');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'SHA256SUMS'), 'sums');
  writeFileSync(join(release, 'SHA256SUMS.sig'), 'sig');
  const offer = await (await call('GET', '/api/bundle')).json();
  assert.deepEqual(offer, {
    name: `shub-2026.10.9-${process.platform}-${process.arch}.bundle.json`,
    manifest,
    sums: 'sums',
    signature: 'sig',
  });
  rmSync(join(dist, 'bundle.json'));
});

test('a device can be renamed', async () => {
  const [device] = await (await asUser('GET', '/api/devices')).json();
  const res = await asUser('PATCH', `/api/devices/${device.id}`, { name: '  Laptop  ' });
  assert.equal((await res.json()).name, 'Laptop');
  assert.equal((await asUser('PATCH', `/api/devices/${device.id}`, { name: ' ' })).status, 400);
  assert.equal((await asUser('PATCH', '/api/devices/nope', { name: 'x' })).status, 404);
});

test('events WebSocket says hello and forwards bus events; needs the device token', async () => {
  const wsUrl = base.replace('http', 'ws') + '/api/events';
  const noToken = new WebSocket(wsUrl, { headers: { origin: base } });
  await new Promise<void>((resolve) => noToken.on('error', () => resolve()));
  const ws = new WebSocket(wsUrl, ['shub', `bearer.${userToken}`], { headers: { origin: base } });
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

test('a bad WebSocket frame closes that socket, not the server', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/api/events', ['shub', `bearer.${userToken}`], {
    headers: { origin: base },
  });
  await new Promise((r) => ws.on('open', r));
  // Opcode 3 is reserved: the server's ws emits 'error' on the socket.
  (ws as unknown as { _socket: Socket })._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
  await new Promise((r) => ws.on('close', r));
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('events SSE stream', async () => {
  const controller = new AbortController();
  const res = await fetch(base + '/api/events/stream', {
    headers: { authorization: `Bearer ${userToken}` },
    signal: controller.signal,
  });
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
  const other = await bootstrapBrowser('other');
  const { device } = await other.res.json();
  const otherToken = await signInWith(device.id, other.privateKey);
  const rotated = await asUser('POST', '/api/auth/rotate');
  assert.equal(rotated.status, 200);
  assert.equal(rotated.headers.get('cache-control'), 'no-store');
  const { token } = (await rotated.json()) as { token: string };
  assert.equal(token, readFileSync(join(ctx.paths.stateDir, 'token'), 'utf8').trim(), 'new token, shown once');
  assert.equal((await call('GET', '/api/auth/me', undefined, { authorization: `Bearer ${otherToken}` })).status, 401);
  assert.equal((await call('POST', '/api/auth/challenge', { deviceId: device.id })).status, 404);
  const me = await asUser('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.ok(!(await me.text()).includes(token), 'not retrievable later');
  assert.equal((await bootstrapBrowser('x')).res.status, 401, 'the old token is dead');
  assert.equal((await bootstrapBrowser('x', token)).res.status, 200);
});
