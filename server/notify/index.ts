// Desktop notifications (notify-send) and web push (VAPID keys in <stateDir>/vapid.json, subscriptions in sqlite).
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { ROUTES, type Approval, type Session } from '../../shared/api.ts';
import { HttpError, requireUser, type Router } from '../api/router.ts';
import { publicUrl } from '../config/index.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Notify, Services } from '../services.ts';

const MIGRATIONS = [
  `CREATE TABLE push_subscriptions (
     endpoint TEXT PRIMARY KEY, device_id TEXT, subscription TEXT NOT NULL, created_at TEXT NOT NULL)`,
  // A phone app that knows several machines owns its VAPID pair and hands it to each; null = this machine's.
  `ALTER TABLE push_subscriptions ADD COLUMN vapid TEXT`,
];

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** This machine's public URL, so an app that knows several opens the right one. */
  origin?: string;
  /** This machine's name (as in GET /api/health), shown in the title on another machine's app. */
  machine?: string;
}

interface Vapid {
  publicKey: string;
  privateKey: string;
}

function loadVapid(stateDir: string): Vapid {
  const file = join(stateDir, 'vapid.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Vapid;
  } catch {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const keys = webpush.generateVAPIDKeys();
    writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    chmodSync(file, 0o600);
    return keys;
  }
}

/** How this computer is called in a phone app that knows several (SHUB_MACHINE_NAME overrides the hostname). */
export const machineName = (): string => process.env.SHUB_MACHINE_NAME || hostname();

function desktop(title: string, body: string): void {
  // Callback swallows ENOENT: no notify-send installed means no desktop notifications.
  execFile('notify-send', ['-a', 'shub', title, body], () => {});
}

const sessionUrl = (session: Session): string => `/?session=${encodeURIComponent(session.id)}`;

export class NotifyService implements Notify {
  #ctx: Context;
  #services: Services;
  #vapid: Vapid | undefined;
  #migrated = false;

  constructor(ctx: Context, services: Services) {
    this.#ctx = ctx;
    this.#services = services;
  }

  get #db() {
    if (!this.#migrated) this.#services.state.migrate('notify', MIGRATIONS);
    this.#migrated = true;
    return this.#services.state.db;
  }

  get publicKey(): string {
    return this.#keys().publicKey;
  }

  #keys(): Vapid {
    if (!this.#vapid) {
      this.#vapid = loadVapid(this.#ctx.paths.stateDir);
      const url = publicUrl(this.#services.config.get());
      const subject = url?.startsWith('https://') ? url : 'mailto:shub@localhost';
      webpush.setVapidDetails(subject, this.#vapid.publicKey, this.#vapid.privateKey);
    }
    return this.#vapid;
  }

  subscribe(subscription: webpush.PushSubscription, deviceId: string | null, vapid?: Vapid): void {
    this.#db
      .prepare(
        'INSERT OR REPLACE INTO push_subscriptions (endpoint, device_id, subscription, created_at, vapid) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        subscription.endpoint,
        deviceId,
        JSON.stringify(subscription),
        new Date().toISOString(),
        vapid ? JSON.stringify(vapid) : null,
      );
    // The devices table belongs to auth; this flag only drives the "push on" label in Settings.
    if (deviceId) this.#db.prepare('UPDATE devices SET push = 1 WHERE id = ?').run(deviceId);
  }

  devicePending(name: string): void {
    desktop('shub: new device', `${name} wants to pair. Approve it in shub > Settings > Devices.`);
  }

  forgetDevice(deviceId: string): void {
    this.#db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?').run(deviceId);
  }

  /** To every subscription, or only those of one device. */
  async push(payload: PushPayload, deviceId?: string): Promise<void> {
    this.#keys();
    const rows = (
      deviceId === undefined
        ? this.#db.prepare('SELECT endpoint, subscription, vapid FROM push_subscriptions').all()
        : this.#db
            .prepare('SELECT endpoint, subscription, vapid FROM push_subscriptions WHERE device_id = ?')
            .all(deviceId)
    ) as { endpoint: string; subscription: string; vapid: string | null }[];
    const url = publicUrl(this.#services.config.get());
    const body = JSON.stringify({ ...payload, origin: url ? new URL(url).origin : undefined, machine: machineName() });
    const subject = url?.startsWith('https://') ? url : 'mailto:shub@localhost';
    await Promise.all(
      rows.map(({ endpoint, subscription, vapid }) =>
        webpush
          .sendNotification(JSON.parse(subscription), body, {
            TTL: 3600,
            ...(vapid ? { vapidDetails: { subject, ...(JSON.parse(vapid) as Vapid) } } : {}),
          })
          .catch((err) => {
            // Gone or unknown: the browser dropped the subscription.
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              this.#db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
            } else console.error('shub: push failed', err?.statusCode ?? err);
          }),
      ),
    );
  }

  needsYou(session: Session, text: string): void {
    const settings = this.#services.config.get().notifications;
    const title = session.name;
    if (settings.desktopNeedsYou) desktop(title, text);
    if (settings.pushNeedsYou)
      void this.push({ title, body: text, url: sessionUrl(session), tag: `session-${session.id}` });
  }

  yourTurn(session: Session): void {
    if (!this.#services.config.get().notifications.pushYourTurn) return;
    const title = session.name;
    void this.push({ title, body: 'Claude finished.', url: sessionUrl(session), tag: `session-${session.id}` });
  }

  approval(approval: Approval): void {
    const title = 'shub: approval needed';
    desktop(title, approval.summary);
    void this.push({ title, body: approval.summary, url: `/?approval=${approval.id}`, tag: `approval-${approval.id}` });
  }

  /** Pushes to that device only; without one (cli) to all devices. */
  async test(deviceId?: string): Promise<void> {
    desktop('shub', 'Test notification');
    await this.push({ title: 'shub', body: 'Test notification', url: '/', tag: 'test' }, deviceId);
  }
}

function isSubscription(value: unknown): value is webpush.PushSubscription {
  const s = value as webpush.PushSubscription;
  return (
    typeof s?.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

/** The app's own VAPID pair: raw P-256 public key (65 bytes) and private scalar (32 bytes), base64url. */
function isVapid(value: unknown): value is Vapid {
  const v = value as Vapid;
  const bytes = (s: unknown) =>
    typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) ? Buffer.from(s, 'base64url').length : 0;
  return bytes(v?.publicKey) === 65 && bytes(v?.privateKey) === 32;
}

function routes(notify: NotifyService, services: Services, router: Router): void {
  router.add(ROUTES.pushKey, () => ({ publicKey: notify.publicKey }));
  router.add(ROUTES.pushSubscribe, async (req) => {
    requireUser(req.caller);
    const body = await req.json<webpush.PushSubscription & { vapid?: unknown }>();
    if (!isSubscription(body)) throw new HttpError(400, 'expected a PushSubscription');
    if (body.vapid !== undefined && !isVapid(body.vapid)) {
      throw new HttpError(400, 'vapid: { publicKey, privateKey } as base64url P-256 keys');
    }
    notify.subscribe({ endpoint: body.endpoint, keys: body.keys }, req.caller.deviceId ?? null, body.vapid);
    return { ok: true };
  });
  router.add(ROUTES.pushTest, async (req) => {
    requireUser(req.caller);
    await notify.test(req.caller.deviceId);
    return { ok: true };
  });
}

export function create(ctx: Context, services: Services): { module: ShubModule; service: NotifyService } {
  const notify = new NotifyService(ctx, services);
  return { module: { name: 'notify', routes: (router) => routes(notify, services, router) }, service: notify };
}
