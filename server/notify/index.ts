// Desktop notifications (notify-send) and web push (VAPID keys in <stateDir>/vapid.json, subscriptions in sqlite).
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
];

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
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

  subscribe(subscription: webpush.PushSubscription, deviceId: string | null): void {
    this.#db
      .prepare('INSERT OR REPLACE INTO push_subscriptions VALUES (?, ?, ?, ?)')
      .run(subscription.endpoint, deviceId, JSON.stringify(subscription), new Date().toISOString());
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
        ? this.#db.prepare('SELECT endpoint, subscription FROM push_subscriptions').all()
        : this.#db.prepare('SELECT endpoint, subscription FROM push_subscriptions WHERE device_id = ?').all(deviceId)
    ) as { endpoint: string; subscription: string }[];
    await Promise.all(
      rows.map(({ endpoint, subscription }) =>
        webpush.sendNotification(JSON.parse(subscription), JSON.stringify(payload), { TTL: 3600 }).catch((err) => {
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

function routes(notify: NotifyService, services: Services, router: Router): void {
  router.add(ROUTES.pushKey, () => ({ publicKey: notify.publicKey }));
  router.add(ROUTES.pushSubscribe, async (req) => {
    requireUser(req.caller);
    const body = await req.json();
    if (!isSubscription(body)) throw new HttpError(400, 'expected a PushSubscription');
    notify.subscribe({ endpoint: body.endpoint, keys: body.keys }, req.caller.deviceId ?? null);
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
