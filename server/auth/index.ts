// Access token, device cookies, phone pairing and per-client Bearer tokens.
// Secrets are only stored as sha256 hashes in sqlite; the access token itself lives in <stateDir>/token (0600).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { ROUTES, type ClientKind, type Device, type Right } from '../../shared/api.ts';
import { publicUrl } from '../config/index.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import { HttpError, requireUser, type Caller, type Router } from '../api/router.ts';
import type { Auth, Services } from '../services.ts';
import { phoneSetupRoutes } from './tailscale.ts';

export const COOKIE = 'shub_session';
const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

const MIGRATIONS = [
  `CREATE TABLE devices (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, session_hash TEXT NOT NULL UNIQUE,
     paired_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, push INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE client_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
];

interface DeviceRow {
  id: string;
  name: string;
  kind: Device['kind'];
  session_hash: string;
  paired_at: string;
  last_seen_at: string;
  push: number;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newSecret = (): string => randomBytes(32).toString('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function bearer(req: IncomingMessage): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (m) return m[1];
  // Browsers cannot set headers on a WebSocket: a peer's app sends `bearer.<token>` as a subprotocol.
  const proto = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
  return proto.find((p) => p.startsWith('bearer.'))?.slice('bearer.'.length) || null;
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    push: row.push === 1,
  };
}

export class AuthService implements Auth {
  #ctx: Context;
  #services: Services;
  #tokenFile: string;
  #tokenHash = '';
  #clients = new Map<string, { kind: ClientKind; id: string }>();
  #pairings = new Map<string, number>(); // code -> expiresAt ms

  constructor(ctx: Context, services: Services) {
    this.#ctx = ctx;
    this.#services = services;
    this.#tokenFile = join(ctx.paths.stateDir, 'token');
  }

  get tokenFile(): string {
    return this.#tokenFile;
  }

  init(): void {
    this.#services.state.migrate('auth', MIGRATIONS);
    this.#loadOrCreateToken();
    const rows = this.#db.prepare('SELECT token_hash, kind, client_id FROM client_tokens').all() as {
      token_hash: string;
      kind: ClientKind;
      client_id: string;
    }[];
    for (const r of rows) this.#clients.set(r.token_hash, { kind: r.kind, id: r.client_id });
  }

  get #db() {
    return this.#services.state.db;
  }

  #loadOrCreateToken(): void {
    let token: string;
    try {
      token = readFileSync(this.#tokenFile, 'utf8').trim();
    } catch {
      token = this.#writeToken();
      console.log(`shub: created access token in ${this.#tokenFile}`);
    }
    this.#tokenHash = sha256(token);
  }

  #writeToken(): string {
    mkdirSync(this.#ctx.paths.stateDir, { recursive: true, mode: 0o700 });
    const token = newSecret();
    writeFileSync(this.#tokenFile, token + '\n', { mode: 0o600 });
    chmodSync(this.#tokenFile, 0o600);
    this.#tokenHash = sha256(token);
    return token;
  }

  #isAccessToken(candidate: unknown): boolean {
    if (typeof candidate !== 'string' || !candidate) return false;
    return timingSafeEqual(Buffer.from(sha256(candidate.trim())), Buffer.from(this.#tokenHash));
  }

  #caller(kind: ClientKind, id: string): Caller {
    let granted: Right[] | undefined;
    if (kind === 'plugin') {
      // Granted in config AND requested by the manifest: a hand-edited config cannot widen a plugin's rights.
      const name = id.slice('plugin:'.length);
      const requested = this.#services.plugins?.requestedRights(name) ?? [];
      granted = (this.#services.config.get().plugins.find((p) => p.name === name)?.grantedRights ?? []).filter((r) =>
        requested.includes(r),
      );
    }
    return { kind, id, rights: this.#services.permissions.rightsFor(kind, granted) };
  }

  deviceOf(req: IncomingMessage): DeviceRow | undefined {
    const session = parseCookies(req.headers.cookie)[COOKIE];
    if (!session) return undefined;
    const row = this.#db.prepare('SELECT * FROM devices WHERE session_hash = ?').get(sha256(session)) as
      DeviceRow | undefined;
    if (!row || Date.now() - Date.parse(row.last_seen_at) > SESSION_MAX_AGE_S * 1000) return undefined;
    return row;
  }

  resolve(req: IncomingMessage): Caller | null {
    const token = bearer(req);
    if (token) {
      if (this.#isAccessToken(token)) return this.#caller('cli', 'cli');
      const client = this.#clients.get(sha256(token));
      return client ? this.#caller(client.kind, client.id) : null;
    }
    const device = this.deviceOf(req);
    if (!device) return null;
    if (Date.now() - Date.parse(device.last_seen_at) > LAST_SEEN_THROTTLE_MS) {
      this.#db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), device.id);
    }
    return { ...this.#caller('user', 'chris'), deviceId: device.id };
  }

  issueClientToken(caller: Caller): string {
    const token = newSecret();
    const hash = sha256(token);
    this.#clients.set(hash, { kind: caller.kind, id: caller.id });
    this.#db
      .prepare('INSERT INTO client_tokens (token_hash, kind, client_id, created_at) VALUES (?, ?, ?, ?)')
      .run(hash, caller.kind, caller.id, new Date().toISOString());
    return token;
  }

  revokeClientToken(token: string): void {
    const hash = sha256(token);
    this.#clients.delete(hash);
    this.#db.prepare('DELETE FROM client_tokens WHERE token_hash = ?').run(hash);
  }

  /** Creates a device and returns its cookie value. */
  createDevice(name: string, kind: Device['kind']): { device: Device; session: string } {
    const session = newSecret();
    const now = new Date().toISOString();
    const row: DeviceRow = {
      id: randomUUID(),
      name: name.slice(0, 100) || kind,
      kind,
      session_hash: sha256(session),
      paired_at: now,
      last_seen_at: now,
      push: 0,
    };
    this.#db
      .prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.kind, row.session_hash, row.paired_at, row.last_seen_at, row.push);
    return { device: toDevice(row), session };
  }

  login(token: unknown, name: string): { device: Device; session: string } {
    if (!this.#isAccessToken(token)) throw new HttpError(401, 'wrong token');
    return this.createDevice(name, 'desktop');
  }

  async startPairing(): Promise<{ code: string; url: string; qrSvg: string; expiresAt: string }> {
    const now = Date.now();
    for (const [code, exp] of this.#pairings) if (exp < now) this.#pairings.delete(code);
    const code = randomBytes(16).toString('base64url');
    const expires = now + PAIRING_TTL_MS;
    this.#pairings.set(code, expires);
    const base = publicUrl(this.#services.config.get()) ?? `http://127.0.0.1:${this.#ctx.port}`;
    const url = `${base}/pair/${code}`;
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    return { code, url, qrSvg, expiresAt: new Date(expires).toISOString() };
  }

  redeemPairing(code: unknown, name: string): { device: Device; session: string } {
    const expires = typeof code === 'string' ? this.#pairings.get(code) : undefined;
    if (!expires) throw new HttpError(401, 'unknown or used pairing code');
    this.#pairings.delete(code as string);
    if (expires < Date.now()) throw new HttpError(401, 'pairing code expired');
    return this.createDevice(name, 'phone');
  }

  devices(): Device[] {
    const rows = this.#db.prepare('SELECT * FROM devices ORDER BY paired_at').all() as unknown as DeviceRow[];
    return rows.map(toDevice);
  }

  renameDevice(id: string, name: string): Device | undefined {
    this.#db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, id);
    const row = this.#db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
    return row && toDevice(row);
  }

  deleteDevice(id: string): boolean {
    const deleted = Number(this.#db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes) > 0;
    this.#services.notify?.forgetDevice(id);
    return deleted;
  }

  /**
   * New access token; every device except `keepDeviceId` is signed out. Client tokens stay valid.
   * Returns the token for the one response that shows it; it is never logged or stored in clear elsewhere.
   */
  rotate(keepDeviceId: string | undefined): string {
    const token = this.#writeToken();
    const others = this.#db.prepare('SELECT id FROM devices WHERE id IS NOT ?').all(keepDeviceId ?? null) as {
      id: string;
    }[];
    for (const { id } of others) this.deleteDevice(id);
    return token;
  }
}

/** `maxAge` null: a browser-session cookie (the device row still expires after 30 days unseen). */
function setSessionCookie(
  req: IncomingMessage,
  res: ServerResponse,
  value: string,
  maxAge: number | null = SESSION_MAX_AGE_S,
): void {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const age = maxAge === null ? '' : `; Max-Age=${maxAge}`;
  res.setHeader(
    'set-cookie',
    `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/${age}${secure}`,
  );
}

function deviceName(body: { deviceName?: unknown }, req: IncomingMessage): string {
  if (typeof body.deviceName === 'string' && body.deviceName.trim()) return body.deviceName.trim();
  return (req.headers['user-agent'] ?? 'browser').slice(0, 60);
}

function routes(auth: AuthService, router: Router): void {
  router.add(
    ROUTES.login,
    async (req, res) => {
      const body = await req.json<{ token?: unknown; deviceName?: unknown; remember?: unknown }>();
      const { device, session } = auth.login(body.token, deviceName(body, req.raw));
      setSessionCookie(req.raw, res, session, body.remember === false ? null : SESSION_MAX_AGE_S);
      return { device };
    },
    { public: true },
  );
  router.add(ROUTES.logout, (req, res) => {
    const device = auth.deviceOf(req.raw);
    if (device) auth.deleteDevice(device.id);
    setSessionCookie(req.raw, res, '', 0);
    return { ok: true };
  });
  router.add(ROUTES.me, (req) => {
    const device = auth.deviceOf(req.raw);
    return { caller: req.caller, device: device ? toDevice(device) : null };
  });
  router.add(ROUTES.pairingStart, (req) => {
    requireUser(req.caller);
    return auth.startPairing();
  });
  router.add(
    ROUTES.pairingRedeem,
    async (req, res) => {
      const body = await req.json<{ code?: unknown; deviceName?: unknown; bearer?: unknown }>();
      const { device, session } = auth.redeemPairing(body.code, deviceName(body, req.raw));
      // Spike: an app installed from another host keeps a Bearer token instead of this origin's cookie.
      if (body.bearer === true)
        return { device, token: auth.issueClientToken({ kind: 'user', id: 'chris', rights: [] }) };
      setSessionCookie(req.raw, res, session);
      return { device };
    },
    { public: true },
  );
  router.add(ROUTES.devices, (req) => {
    requireUser(req.caller);
    return auth.devices();
  });
  router.add(ROUTES.deviceUpdate, async (req) => {
    requireUser(req.caller);
    const { name } = await req.json<{ name?: unknown }>();
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name is required');
    const device = auth.renameDevice(req.params.id, name.trim().slice(0, 60));
    if (!device) throw new HttpError(404, 'no such device');
    return device;
  });
  router.add(ROUTES.deviceDelete, (req) => {
    requireUser(req.caller);
    if (!auth.deleteDevice(req.params.id)) throw new HttpError(404, 'no such device');
    return { ok: true };
  });
  router.add(ROUTES.rotateToken, (req) => {
    requireUser(req.caller);
    // Shown once: the response is no-store, and nothing else (logs, activity, /me) ever carries it.
    const token = auth.rotate(req.caller.deviceId);
    return { ok: true, token, tokenFile: auth.tokenFile };
  });
}

export function create(ctx: Context, services: Services): { module: ShubModule; service: AuthService } {
  // main.ts creates state before auth, so the db is ready here.
  const auth = new AuthService(ctx, services);
  auth.init();
  return {
    module: { name: 'auth', routes: (router) => (routes(auth, router), phoneSetupRoutes(ctx, services, router)) },
    service: auth,
  };
}
