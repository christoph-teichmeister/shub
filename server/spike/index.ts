// Multi-host PWA spike (card "Test one shub PWA for several hosts"); only active with SHUB_SPIKE_BUNDLE_DIR set.
// - GET  /api/spike/bundle      the signed app bundle this host offers (public: the signature is the trust, not the host)
// - POST /api/spike/push        { subscription, publicKey, privateKey }: the app's own VAPID pair, shared by every host
// - POST /api/spike/push/test   { delaySeconds }: push to every stored subscription with that subscription's keys
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { HttpError, requireUser } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';

interface Registration {
  subscription: webpush.PushSubscription;
  publicKey: string;
  privateKey: string;
}

export function create(_ctx: Context, _services: Services): { module: ShubModule } {
  const dir = process.env.SHUB_SPIKE_BUNDLE_DIR;
  // ponytail: in memory, lost on restart; the real build stores them with the device.
  const registrations = new Map<string, Registration>();
  return {
    module: {
      name: 'spike',
      routes(router) {
        if (!dir) return;
        router.add(
          'GET /api/spike/bundle',
          () => ({
            bundle: readFileSync(join(dir, 'bundle.json'), 'utf8'),
            signature: readFileSync(join(dir, 'bundle.sig'), 'utf8').trim(),
          }),
          { public: true },
        );
        router.add('POST /api/spike/push', async (req) => {
          requireUser(req.caller);
          const body = await req.json<Partial<Registration>>();
          if (!body.subscription?.endpoint || !body.publicKey || !body.privateKey) {
            throw new HttpError(400, 'subscription, publicKey and privateKey are required');
          }
          registrations.set(body.subscription.endpoint, body as Registration);
          return { ok: true, count: registrations.size };
        });
        router.add('POST /api/spike/push/test', async (req) => {
          requireUser(req.caller);
          const { delaySeconds } = await req.json<{ delaySeconds?: number }>();
          const host = req.raw.headers.host ?? 'shub';
          setTimeout(
            () => {
              for (const r of registrations.values()) {
                webpush
                  .sendNotification(
                    r.subscription,
                    JSON.stringify({ title: `shub on ${host}`, body: 'Test push from this host', tag: host }),
                    {
                      TTL: 600,
                      vapidDetails: {
                        subject: 'mailto:shub@localhost',
                        publicKey: r.publicKey,
                        privateKey: r.privateKey,
                      },
                    },
                  )
                  .catch((err) => console.error('shub spike: push failed', err?.statusCode ?? err));
              }
            },
            Math.min(Math.max(Number(delaySeconds) || 0, 0), 120) * 1000,
          );
          return { ok: true, count: registrations.size };
        });
      },
    },
  };
}
