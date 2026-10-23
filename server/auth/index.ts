// Access token, device keys (every browser and phone), pairing and per-client Bearer tokens.
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
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { DEVICE_LEVELS, ROUTES, type ClientKind, type Device, type DeviceLevel, type Right } from '../../shared/api.ts';
import { publicUrl } from '../config/index.ts';
import { kindOf } from '../group/index.ts';
import { machineName } from '../notify/index.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import { HttpError, requireUser, type Caller, type Router } from '../api/router.ts';
import { closeDeviceSockets } from '../api/upgrade.ts';
import type { Auth, Services } from '../services.ts';
import { phoneSetupRoutes } from './tailscale.ts';

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
  // Every browser and phone signs in with a key pair (public half here); cookie rows (no key) are dropped on start.
  `ALTER TABLE devices ADD COLUMN public_key TEXT`,
  `ALTER TABLE devices ADD COLUMN level TEXT NOT NULL DEFAULT 'control'`,
  `ALTER TABLE devices ADD COLUMN state TEXT NOT NULL DEFAULT 'active'`,
  // The origin of the app the phone paired from: another machine's app calls this one cross-origin (CORS).
  `ALTER TABLE devices ADD COLUMN app_origin TEXT`,
  // The host that made the pairing code the device redeemed (shown in the approve dialog).
  `ALTER TABLE devices ADD COLUMN via TEXT`,
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
  via: string | null;
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
    host: row.via ?? undefined,
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
  #services: Services;
  #tokenFile: string;
  #tokenHash = '';
  #clients = new Map<string, { kind: ClientKind; id: string }>();
  #pairings = new Map<string, { expires: number; host: string }>(); // code -> expiry (ms) and the host that made it
  #pairingMisses = 0;
  #challenges = new Map<string, { deviceId: string; expires: number }>(); // nonce -> device
  #deviceTokens = new Map<string, { deviceId: string; expires: number }>(); // token hash -> device

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

  resolve(req: IncomingMessage): Caller | null {
    const token = bearer(req);
    if (token) {
      const signedIn = this.#deviceTokens.get(sha256(token));
      if (signedIn) return this.#deviceCaller(signedIn);
      if (this.#isAccessToken(token)) return this.#caller('cli', 'cli');
      const client = this.#clients.get(sha256(token));
      return client ? this.#caller(client.kind, client.id) : null;
    }
    return null;
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

  /**
   * Creates a device that signs in with its key. `desktop` is the host's own browser (bootstrap), `browser` a paired
   * desktop browser, `phone` a phone; a new phone may answer prompts once approved, browsers get control.
   */
  createDevice(
    name: string,
    kind: Device['kind'],
    key: { publicKey: string; appOrigin?: string | null; via?: string | null },
    active = false,
  ): Device {
    const now = new Date().toISOString();
    const row: DeviceRow = {
      id: randomUUID(),
      name: name.slice(0, 100) || kind,
      kind,
      session_hash: sha256(newSecret()), // column predates key sign-in; only has to be unique
      paired_at: now,
      last_seen_at: now,
      push: 0,
      public_key: key.publicKey,
      app_origin: key.appOrigin ?? null,
      via: key.via ?? null,
      level: kind === 'phone' ? 'prompts' : 'control',
      state: active ? 'active' : 'pending',
    };
    this.#insert(row);
    this.#publish(row.id);
    this.#ctx.bus.emit({ type: 'devices.changed' });
    return toDevice(row);
  }

  #insert(row: DeviceRow): void {
    this.#db
      .prepare(
        `INSERT INTO devices
           (id, name, kind, session_hash, paired_at, last_seen_at, push, public_key, level, state, app_origin, via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.via,
      );
  }

  /** Writes the device into the group as `device:<id>` so every host learns of it, its level and its revoke. */
  #publish(id: string): void {
    const r = this.#row(id);
    if (!r?.public_key) return;
    this.#services.group.put(`device:${id}`, {
      name: r.name,
      kind: r.kind,
      publicKey: r.public_key,
      appOrigin: r.app_origin,
      via: r.via,
      level: r.level,
      state: r.state,
      pairedAt: r.paired_at,
    });
  }

  /**
   * Makes this host's devices match the group's items: new ones join, level and state follow, a tombstone ends the
   * device here (tokens and sockets at once). Called after the host-to-host sync merged items, and on start so a host
   * that was offline applies a revoke when it comes back. A key is never replaced and a tombstone never undone.
   */
  applyGroup(): void {
    for (const item of this.#services.group.list()) {
      if (kindOf(item.key) !== 'device') continue;
      const id = item.key.slice('device:'.length);
      const row = this.#row(id);
      const b = item.body as Record<string, string | null> | null;
      if (item.deleted || !b) {
        if (row) this.#drop(id);
        continue;
      }
      if (!row) {
        this.#insert({
          id,
          name: b.name!,
          kind: b.kind as Device['kind'],
          session_hash: sha256(newSecret()),
          paired_at: b.pairedAt!,
          last_seen_at: new Date().toISOString(),
          push: 0,
          public_key: b.publicKey!,
          app_origin: b.appOrigin ?? null,
          via: b.via ?? null,
          level: b.level as DeviceLevel,
          state: b.state as Device['state'],
        });
      } else if (row.level !== b.level || row.state !== b.state || row.name !== b.name) {
        this.#db
          .prepare('UPDATE devices SET level = ?, state = ?, name = ? WHERE id = ?')
          .run(b.level!, b.state!, b.name!, id);
        if (row.level !== b.level) closeDeviceSockets(id);
      } else continue;
      this.#ctx.bus.emit({ type: 'devices.changed' });
    }
  }

  /** The first browser on a host: the access token (read from the token file, so you are on the machine) is its proof. */
  bootstrap(token: unknown, name: string, publicKey: unknown): Device {
    if (!this.#isAccessToken(token)) throw new HttpError(401, 'wrong token');
    return this.createDevice(name, 'desktop', { publicKey: parsePublicKey(publicKey) }, true);
  }

  async startPairing(): Promise<{ code: string; url: string; qrSvg: string; expiresAt: string }> {
    const now = Date.now();
    for (const [code, exp] of this.#pairings) if (exp.expires < now) this.#pairings.delete(code);
    const code = newCode();
    const expires = now + PAIRING_TTL_MS;
    this.#pairings.set(code, { expires, host: machineName() });
    this.#pairingMisses = 0;
    const base = publicUrl(this.#services.config.get()) ?? `http://127.0.0.1:${this.#ctx.port}`;
    const url = `${base}/pair/${code}`;
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    return { code, url, qrSvg, expiresAt: new Date(expires).toISOString() };
  }

  /** The device keeps its private key; it waits as pending until approved on this machine. */
  redeemPairing(
    code: unknown,
    name: string,
    publicKey: unknown,
    appOrigin: string | null = null,
    kind: unknown = 'phone',
  ): Device {
    const key = parsePublicKey(publicKey);
    if (this.#pairingMisses >= MAX_PAIRING_MISSES) throw new HttpError(429, 'too many wrong codes; make a new one');
    const normalized = typeof code === 'string' ? normalizeCode(code) : '';
    const pairing = this.#pairings.get(normalized);
    if (!pairing) {
      this.#pairingMisses++;
      throw new HttpError(401, 'unknown or used pairing code');
    }
    this.#pairings.delete(normalized);
    if (pairing.expires < Date.now()) throw new HttpError(401, 'pairing code expired');
    const device = this.createDevice(name, kind === 'browser' ? 'browser' : 'phone', {
      publicKey: key,
      appOrigin,
      via: pairing.host,
    });
    this.#services.notify?.devicePending(device.name);
    return device;
  }

  challenge(deviceId: unknown): { nonce: string } {
    const row = typeof deviceId === 'string' ? this.#row(deviceId) : undefined;
    if (!row?.public_key) throw new HttpError(404, 'unknown device');
    if (row.state !== 'active') throw new HttpError(409, 'waiting for approval');
    const now = Date.now();
    for (const [n, c] of this.#challenges) if (c.expires < now) this.#challenges.delete(n);
    const nonce = randomBytes(32).toString('base64url');
    this.#challenges.set(nonce, { deviceId: row.id, expires: now + CHALLENGE_TTL_MS });
    return { nonce };
  }

  /** Checks the device's signature over the challenge and hands out a short-lived token. */
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
    this.#publish(id);
    return this.#changed(id);
  }

  setLevel(id: string, level: DeviceLevel): Device | undefined {
    this.#db.prepare('UPDATE devices SET level = ? WHERE id = ?').run(level, id);
    this.#publish(id);
    // Open sockets were let in with the old level (terminal typing is decided at connect).
    closeDeviceSockets(id);
    return this.#changed(id);
  }

  #changed(id: string): Device | undefined {
    const row = this.#row(id);
    this.#ctx.bus.emit({ type: 'devices.changed' });
    return row && toDevice(row);
  }

  /** Devices from before key sign-in (cookie, no key) are dropped: a browser signs in once with the token and gets a key. */
  dropCookieDevices(): void {
    const rows = this.#db.prepare('SELECT id FROM devices WHERE public_key IS NULL').all() as {
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
    this.#publish(id);
    const row = this.#db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
    return row && toDevice(row);
  }

  /** Revoke: the device ends here at once and a tombstone in the group ends it on every host. */
  deleteDevice(id: string): boolean {
    this.#services.group.remove(`device:${id}`);
    return this.#drop(id);
  }

  #drop(id: string): boolean {
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

/**
 * Approving a device and changing its level work on a trusted host (the host's own browser, kind `desktop`, opened via
 * loopback, or the CLI) or from a phone at level Control (it confirms in a dialog that names the device). Nothing
 * else: a secret in a synced file admits nobody, and no device raises itself.
 */
const isLoopback = (req: IncomingMessage): boolean =>
  ['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''));

const deviceOf = (auth: AuthService, caller: Caller): Device | undefined =>
  caller.kind === 'user' && caller.deviceId ? auth.devices().find((d) => d.id === caller.deviceId) : undefined;

function mayManageDevices(auth: AuthService, req: IncomingMessage, caller: Caller): boolean {
  if (caller.kind === 'cli') return true;
  const own = deviceOf(auth, caller);
  if (own?.kind === 'desktop') return isLoopback(req);
  return own?.kind === 'phone' && own.level === 'control';
}

function requireManager(auth: AuthService, req: IncomingMessage, caller: Caller): void {
  requireUser(caller);
  if (!mayManageDevices(auth, req, caller)) {
    throw new HttpError(403, 'only possible on a trusted host or from a phone at level Control');
  }
}

function deviceName(body: { deviceName?: unknown }, req: IncomingMessage): string {
  if (typeof body.deviceName === 'string' && body.deviceName.trim()) return body.deviceName.trim();
  return (req.headers['user-agent'] ?? 'browser').slice(0, 60);
}

function routes(auth: AuthService, router: Router): void {
  router.add(
    ROUTES.bootstrap,
    async (req) => {
      // Only in shub opened on the machine itself; a tailnet peer cannot become the first browser.
      if (!isLoopback(req.raw)) throw new HttpError(403, 'only possible in shub on the machine itself');
      const body = await req.json<{ token?: unknown; deviceName?: unknown; publicKey?: unknown }>();
      return { device: auth.bootstrap(body.token, deviceName(body, req.raw), body.publicKey) };
    },
    { public: true },
  );
  router.add(ROUTES.logout, (req) => {
    if (req.caller.deviceId) auth.deleteDevice(req.caller.deviceId);
    return { ok: true };
  });
  router.add(ROUTES.me, (req) => {
    const id = req.caller.deviceId;
    const device = id ? auth.devices().find((d) => d.id === id) : undefined;
    return { caller: req.caller, device: device ?? null, local: mayManageDevices(auth, req.raw, req.caller) };
  });
  router.add(ROUTES.pairingStart, (req) => {
    requireUser(req.caller);
    return auth.startPairing();
  });
  router.add(
    ROUTES.pairingRedeem,
    async (req, res) => {
      const body = await req.json<{ code?: unknown; deviceName?: unknown; publicKey?: unknown; kind?: unknown }>();
      // Another machine's app pairs cross-origin; remember its origin so it may call this machine later.
      const origin = req.raw.headers.origin?.toLowerCase() ?? null;
      return { device: auth.redeemPairing(body.code, deviceName(body, req.raw), body.publicKey, origin, body.kind) };
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
  router.add(ROUTES.deviceApprove, async (req) => {
    requireManager(auth, req.raw, req.caller);
    // A phone approves through a dialog that names the device; the app says so with `confirm`.
    if (deviceOf(auth, req.caller)?.kind === 'phone' && (await req.json<{ confirm?: unknown }>()).confirm !== true) {
      throw new HttpError(400, 'confirm the device first');
    }
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
      requireManager(auth, req.raw, req.caller);
      if (req.params.id === req.caller.deviceId) throw new HttpError(403, 'a device never changes its own level');
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
      start: () => (auth.dropCookieDevices(), auth.applyGroup()),
    },
    service: auth,
  };
}
