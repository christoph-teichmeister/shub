// HTTP routes for sign-in, pairing and devices, plus who may approve a device or change its level.
import type { IncomingMessage } from 'node:http';
import { DEVICE_LEVELS, ROUTES, type Device, type DeviceLevel } from '../../shared/api.ts';
import { HttpError, requireUser, type Caller, type Router } from '../api/router.ts';
import type { AuthService } from './index.ts';

/**
 * Approving a device and changing its level work on a trusted host (the host's own browser, kind `desktop`, opened via
 * loopback, or the CLI) or from a phone at level Control (it confirms in a dialog that names the device). Nothing
 * else: a secret in a synced file admits nobody, and no device raises itself.
 */
const isLoopback = (req: IncomingMessage): boolean =>
  ['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''));

export const deviceOf = (auth: AuthService, caller: Caller): Device | undefined =>
  caller.kind === 'user' && caller.deviceId ? auth.devices().find((d) => d.id === caller.deviceId) : undefined;

export function mayManageDevices(auth: AuthService, req: IncomingMessage, caller: Caller): boolean {
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

const isLevel = (value: unknown): value is DeviceLevel => DEVICE_LEVELS.includes(value as DeviceLevel);

function deviceName(body: { deviceName?: unknown }, req: IncomingMessage): string {
  if (typeof body.deviceName === 'string' && body.deviceName.trim()) return body.deviceName.trim();
  return (req.headers['user-agent'] ?? 'browser').slice(0, 60);
}

export function routes(auth: AuthService, router: Router): void {
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
