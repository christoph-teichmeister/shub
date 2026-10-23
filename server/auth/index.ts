// Access token, device cookies, phone pairing and per-client Bearer tokens.
// Secrets are only stored as sha256 hashes in sqlite; the access token itself lives in <stateDir>/token (0600).
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { DEVICE_LEVELS, ROUTES, type ClientKind, type Device, type DeviceLevel, type Right } from '../../shared/api.ts';
import { publicUrl } from '../config/index.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import { HttpError, requireUser, type Caller, type Router } from '../api/router.ts';
import { closeDeviceSockets } from '../api/upgrade.ts';
import type { Auth, Services } from '../services.ts';
import { phoneSetupRoutes } from './tailscale.ts';

/**
 * Browsers keep cookies per host, not per port, so a second shub on the same machine (a test copy on another port)
 * gets its own cookie name instead of signing the other one out. The default port keeps the plain name.
 */
export const cookieName = (port: number): string => (port === 4780 ? 'shub_session' : `shub_session_${port}`);
const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;
/** A phone's sign-in token lives this long, in memory only; the app renews it by signing a new challenge. */
export const DEVICE_TOKEN_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_TTL_MS = 60 * 1000;
/** What a phone signs: the nonce bound to its purpose. */
export const challengeMessage = (nonce: string): string => `shub-login:${nonce}`;

const MIGRATIONS = [
  `CREATE TABLE devices (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, session_hash TEXT NOT NULL UNIQUE,
     paired_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, push INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE client_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
  // Phones sign in with a key pair (public half here); desktop logins with the access token keep the cookie.
  `ALTER TABLE devices ADD COLUMN public_key TEXT`,
  `ALTER TABLE devices ADD COLUMN level TEXT NOT NULL DEFAULT 'control'`,
  `ALTER TABLE devices ADD COLUMN state TEXT NOT NULL DEFAULT 'active'`,
  // The origin of the app the phone paired from: another machine's app calls this one cross-origin (CORS).
  `ALTER TABLE devices ADD COLUMN app_origin TEXT`,
];

interface DeviceRow {
  id: string;
  name: string;
  kind: Device['kind'];
  session_hash: string;
  paired_at: string;
  last_seen_at: string;
  push: number;
  public_key: string | null;
  app_origin: string | null;
  level: DeviceLevel;
  state: Device['state'];
}

/** Pairing codes are short enough to type: 8 characters without look-alikes (40 bits), single use, 5 minutes. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string => Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % 32]).join('');
/** "abcd-efgh", "ABCD EFGH" and "ABCDEFGH" are the same code. */
export const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Wrong codes allowed per pairing window before pairing locks until a new code is made. */
const MAX_PAIRING_MISSES = 20;

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
  // Browsers cannot set headers on a WebSocket: the phone app sends `bearer.<token>` as a subprotocol.
  const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
  return protocols.find((p) => p.startsWith('bearer.'))?.slice('bearer.'.length) || null;
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    push: row.push === 1,
    level: row.level,
    state: row.state,
  };
}

/** A phone's public key as JWK (ECDSA P-256); throws 400 on anything else. */
function parsePublicKey(value: unknown): string {
  const jwk = value as JsonWebKey | undefined;
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) {
    throw new HttpError(400, 'publicKey must be an ECDSA P-256 public JWK');
  }
  try {
    createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch {
    throw new HttpError(400, 'publicKey is not a valid P-256 key');
  }
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
}

const isLevel = (value: unknown): value is DeviceLevel => DEVICE_LEVELS.includes(value as DeviceLevel);

export class AuthService implements Auth {
  #ctx: Context;
  readonly cookie: string;
  #services: Services;
  #tokenFile: string;
  #tokenHash = '';
  #clients = new Map<string, { kind: ClientKind; id: string }>();
  #pairings = new Map<string, number>(); // code -> expiresAt ms
  #pairingMisses = 0;
  #challenges = new Map<string, { deviceId: string; expires: number }>(); // nonce -> device
  #deviceTokens = new Map<string, { deviceId: string; expires: number }>(); // token hash -> device

  constructor(ctx: Context, services: Services) {
    this.#ctx = ctx;
    this.cookie = cookieName(ctx.port);
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
    this.pruneStaleDesktops();
  }

  /** A desktop cookie unused for 30 days no longer signs in (see `deviceOf`); its row would only pile up. */
  pruneStaleDesktops(): void {
    const cutoff = new Date(Date.now() - SESSION_MAX_AGE_S * 1000).toISOString();
    const rows = this.#db.prepare("SELECT id FROM devices WHERE kind = 'desktop' AND last_seen_at < ?").all(cutoff) as {
      id: string;
    }[];
    for (const { id } of rows) this.deleteDevice(id);
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
    const session = parseCookies(req.headers.cookie)[this.cookie];
    if (!session) return undefined;
    const row = this.#db.prepare('SELECT * FROM devices WHERE session_hash = ?').get(sha256(session)) as
      DeviceRow | undefined;
    if (!row || Date.now() - Date.parse(row.last_seen_at) > SESSION_MAX_AGE_S * 1000) return undefined;
    return row;
  }

  resolve(req: IncomingMessage): Caller | null {
    const token = bearer(req);
    if (token) {
      const signedIn = this.#deviceTokens.get(sha256(token));
      if (signedIn) return this.#deviceCaller(signedIn);
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

  #deviceCaller(entry: { deviceId: string; expires: number }): Caller | null {
    if (entry.expires < Date.now()) return null;
    const row = this.#row(entry.deviceId);
    if (!row || row.state !== 'active') return null;
    if (Date.now() - Date.parse(row.last_seen_at) > LAST_SEEN_THROTTLE_MS) {
      this.#db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    }
    return { ...this.#caller('user', 'chris'), deviceId: row.id, level: row.level };
  }

  #row(id: string): DeviceRow | undefined {
    return this.#db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
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

  /** Creates a device and returns its cookie value (unused for phones, which sign in with their key). */
  createDevice(
    name: string,
    kind: Device['kind'],
    phone?: { publicKey: string; appOrigin?: string | null },
  ): { device: Device; session: string } {
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
      public_key: phone?.publicKey ?? null,
      app_origin: phone?.appOrigin ?? null,
      // A new phone may answer prompts once approved; control needs a second look on the machine.
      level: phone ? 'prompts' : 'control',
      state: phone ? 'pending' : 'active',
    };
    this.#db
      .prepare(
        `INSERT INTO devices
           (id, name, kind, session_hash, paired_at, last_seen_at, push, public_key, level, state, app_origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.name,
        row.kind,
        row.session_hash,
        row.paired_at,
        row.last_seen_at,
        row.push,
        row.public_key,
        row.level,
        row.state,
        row.app_origin,
      );
    if (phone) this.#ctx.bus.emit({ type: 'devices.changed' });
    return { device: toDevice(row), session };
  }

  /** A browser that still holds a valid desktop cookie gets a fresh secret on its own device, not a second row. */
  login(token: unknown, name: string, current?: DeviceRow): { device: Device; session: string } {
    if (!this.#isAccessToken(token)) throw new HttpError(401, 'wrong token');
    this.pruneStaleDesktops();
    if (current?.kind !== 'desktop') return this.createDevice(name, 'desktop');
    const session = newSecret();
    const now = new Date().toISOString();
    this.#db
      .prepare('UPDATE devices SET session_hash = ?, last_seen_at = ? WHERE id = ?')
      .run(sha256(session), now, current.id);
    const row = this.#db.prepare('SELECT * FROM devices WHERE id = ?').get(current.id) as unknown as DeviceRow;
    return { device: toDevice(row), session };
  }

  async startPairing(): Promise<{ code: string; url: string; qrSvg: string; expiresAt: string }> {
    const now = Date.now();
    for (const [code, exp] of this.#pairings) if (exp < now) this.#pairings.delete(code);
    const code = newCode();
    const expires = now + PAIRING_TTL_MS;
    this.#pairings.set(code, expires);
    this.#pairingMisses = 0;
    const base = publicUrl(this.#services.config.get()) ?? `http://127.0.0.1:${this.#ctx.port}`;
    const url = `${base}/pair/${code}`;
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    return { code, url, qrSvg, expiresAt: new Date(expires).toISOString() };
  }

  /** The phone keeps its private key; the device waits as pending until approved on this machine. */
  redeemPairing(code: unknown, name: string, publicKey: unknown, appOrigin: string | null = null): Device {
    const key = parsePublicKey(publicKey);
    if (this.#pairingMisses >= MAX_PAIRING_MISSES) throw new HttpError(429, 'too many wrong codes; make a new one');
    const normalized = typeof code === 'string' ? normalizeCode(code) : '';
    const expires = this.#pairings.get(normalized);
    if (!expires) {
      this.#pairingMisses++;
      throw new HttpError(401, 'unknown or used pairing code');
    }
    this.#pairings.delete(normalized);
    if (expires < Date.now()) throw new HttpError(401, 'pairing code expired');
    const { device } = this.createDevice(name, 'phone', { publicKey: key, appOrigin });
    this.#services.notify?.devicePending(device.name);
    return device;
  }

  challenge(deviceId: unknown): { nonce: string } {
    const row = typeof deviceId === 'string' ? this.#row(deviceId) : undefined;
    if (!row?.public_key) throw new HttpError(404, 'unknown device');
    if (row.state !== 'active') throw new HttpError(409, 'waiting for approval on the machine');
    const now = Date.now();
    for (const [n, c] of this.#challenges) if (c.expires < now) this.#challenges.delete(n);
    const nonce = randomBytes(32).toString('base64url');
    this.#challenges.set(nonce, { deviceId: row.id, expires: now + CHALLENGE_TTL_MS });
    return { nonce };
  }

  /** Checks the phone's signature over the challenge and hands out a short-lived token. */
  signIn(deviceId: unknown, nonce: unknown, signature: unknown): { token: string; expiresAt: string } {
    const challenge = typeof nonce === 'string' ? this.#challenges.get(nonce) : undefined;
    if (typeof nonce === 'string') this.#challenges.delete(nonce);
    if (!challenge || challenge.expires < Date.now() || challenge.deviceId !== deviceId) {
      throw new HttpError(401, 'unknown or expired challenge');
    }
    const row = this.#row(challenge.deviceId);
    if (!row?.public_key || row.state !== 'active') throw new HttpError(401, 'device not active');
    const ok =
      typeof signature === 'string' &&
      verify(
        'sha256',
        Buffer.from(challengeMessage(nonce as string)),
        { key: createPublicKey({ key: JSON.parse(row.public_key), format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      );
    if (!ok) throw new HttpError(401, 'bad signature');
    const token = newSecret();
    const expires = Date.now() + DEVICE_TOKEN_TTL_MS;
    for (const [h, t] of this.#deviceTokens) if (t.expires < Date.now()) this.#deviceTokens.delete(h);
    this.#deviceTokens.set(sha256(token), { deviceId: row.id, expires });
    return { token, expiresAt: new Date(expires).toISOString() };
  }

  /** App origins of paired phones (pending ones too, they poll for approval): allowed to call cross-origin. */
  appOrigins(): string[] {
    const rows = this.#db.prepare('SELECT DISTINCT app_origin FROM devices WHERE app_origin IS NOT NULL').all() as {
      app_origin: string;
    }[];
    return rows.map((r) => r.app_origin);
  }

  approve(id: string): Device | undefined {
    this.#db.prepare("UPDATE devices SET state = 'active' WHERE id = ?").run(id);
    return this.#changed(id);
  }

  setLevel(id: string, level: DeviceLevel): Device | undefined {
    this.#db.prepare('UPDATE devices SET level = ? WHERE id = ?').run(level, id);
    // Open sockets were let in with the old level (terminal typing is decided at connect).
    closeDeviceSockets(id);
    return this.#changed(id);
  }

  #changed(id: string): Device | undefined {
    const row = this.#row(id);
    this.#ctx.bus.emit({ type: 'devices.changed' });
    return row && toDevice(row);
  }

  /** Phones paired before key sign-in kept a 30-day cookie; they pair again. */
  dropCookiePhones(): void {
    const rows = this.#db.prepare("SELECT id FROM devices WHERE kind = 'phone' AND public_key IS NULL").all() as {
      id: string;
    }[];
    for (const { id } of rows) this.deleteDevice(id);
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
    for (const [h, t] of this.#deviceTokens) if (t.deviceId === id) this.#deviceTokens.delete(h);
    closeDeviceSockets(id);
    this.#services.notify?.forgetDevice(id);
    if (deleted) this.#ctx.bus.emit({ type: 'devices.changed' });
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
  name: string,
  value: string,
  maxAge: number | null = SESSION_MAX_AGE_S,
): void {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const age = maxAge === null ? '' : `; Max-Age=${maxAge}`;
  res.setHeader('set-cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/${age}${secure}`);
}

/**
 * Approving a device and changing its level happen only on the machine itself: shub opened via loopback in a
 * browser signed in with the access token, or the CLI. A phone (any level) never raises itself or another phone.
 */
function onThisMachine(req: IncomingMessage, caller: Caller): boolean {
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  return caller.kind === 'cli' || (loopback && caller.kind === 'user' && !caller.level);
}

function requireThisMachine(req: IncomingMessage, caller: Caller): void {
  requireUser(caller);
  if (!onThisMachine(req, caller)) throw new HttpError(403, 'only possible in shub on the machine itself');
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
      const { device, session } = auth.login(body.token, deviceName(body, req.raw), auth.deviceOf(req.raw));
      setSessionCookie(req.raw, res, auth.cookie, session, body.remember === false ? null : SESSION_MAX_AGE_S);
      return { device };
    },
    { public: true },
  );
  router.add(ROUTES.logout, (req, res) => {
    if (req.caller.deviceId) auth.deleteDevice(req.caller.deviceId);
    setSessionCookie(req.raw, res, auth.cookie, '', 0);
    return { ok: true };
  });
  router.add(ROUTES.me, (req) => {
    const id = req.caller.deviceId;
    const device = id ? auth.devices().find((d) => d.id === id) : undefined;
    return { caller: req.caller, device: device ?? null, local: onThisMachine(req.raw, req.caller) };
  });
  router.add(ROUTES.pairingStart, (req) => {
    requireUser(req.caller);
    return auth.startPairing();
  });
  router.add(
    ROUTES.pairingRedeem,
    async (req, res) => {
      const body = await req.json<{ code?: unknown; deviceName?: unknown; publicKey?: unknown }>();
      // Another machine's app pairs cross-origin; remember its origin so it may call this machine later.
      const origin = req.raw.headers.origin?.toLowerCase() ?? null;
      return { device: auth.redeemPairing(body.code, deviceName(body, req.raw), body.publicKey, origin) };
    },
    { public: true },
  );
  router.add(ROUTES.authChallenge, async (req) => auth.challenge((await req.json<{ deviceId?: unknown }>()).deviceId), {
    public: true,
  });
  router.add(
    ROUTES.authSession,
    async (req) => {
      const body = await req.json<{ deviceId?: unknown; nonce?: unknown; signature?: unknown }>();
      return auth.signIn(body.deviceId, body.nonce, body.signature);
    },
    { public: true },
  );
  router.add(ROUTES.deviceApprove, (req) => {
    requireThisMachine(req.raw, req.caller);
    const device = auth.approve(req.params.id);
    if (!device) throw new HttpError(404, 'no such device');
    return device;
  });
  router.add(ROUTES.devices, (req) => {
    requireUser(req.caller);
    return auth.devices();
  });
  router.add(ROUTES.deviceUpdate, async (req) => {
    requireUser(req.caller);
    const { name, level } = await req.json<{ name?: unknown; level?: unknown }>();
    let device: Device | undefined;
    if (level !== undefined) {
      if (!isLevel(level)) throw new HttpError(400, `level must be one of ${DEVICE_LEVELS.join(', ')}`);
      requireThisMachine(req.raw, req.caller);
      device = auth.setLevel(req.params.id, level);
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name must be a non-empty string');
      device = auth.renameDevice(req.params.id, name.trim().slice(0, 60));
    }
    if (level === undefined && name === undefined) throw new HttpError(400, 'name or level is required');
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
    module: {
      name: 'auth',
      routes: (router) => (routes(auth, router), phoneSetupRoutes(ctx, services, router)),
      // After every module exists, so the dropped phones' push subscriptions go too.
      start: () => auth.dropCookiePhones(),
    },
    service: auth,
  };
}
