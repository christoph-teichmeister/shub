// shub service worker (ES module): web push and the app loader.
// Loader: the app (index.html, JS, CSS, icons) comes from a cached bundle, so a phone app opens while the machine
// it was installed from is off. Updates come from any paired machine: its bundle counts when its release's
// SHA256SUMS is signed by a shub release key (loader.js), the install machine's own bundle always. Newest wins.
// Without a bundle (dev build, no bundle.json) it falls back to network first with a small offline shell.
import { LOADER_FILES, pickNewest, sha256hex, verifyOffer } from './loader.js';
import { RELEASE_KEYS } from './release-keys.js';

const SHELL = 'shub-shell-v1';
const SHELL_FILES = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png'];
const META = 'shub-loader';
const META_KEY = '/__shub/bundle';

/** { version, cache, origin } of the bundle the app runs, or null. */
async function current() {
  const hit = await (await caches.open(META)).match(META_KEY);
  return hit ? hit.json() : null;
}

/** Downloads every file of a verified bundle from its machine, checks each hash, then switches to it. */
async function install({ origin, manifest }) {
  const name = `shub-app-${manifest.version}`;
  const cache = await caches.open(name);
  for (const [path, hash] of Object.entries(manifest.files)) {
    const res = await fetch(origin + path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const body = await res.arrayBuffer();
    if ((await sha256hex(body)) !== hash) throw new Error(`${path} does not match bundle.json`);
    await cache.put(path, new Response(body, { headers: { 'content-type': res.headers.get('content-type') ?? '' } }));
  }
  const meta = { version: manifest.version, cache: name, origin };
  await (await caches.open(META)).put(META_KEY, new Response(JSON.stringify(meta)));
  for (const key of await caches.keys()) if (key.startsWith('shub-app-') && key !== name) await caches.delete(key);
  return meta;
}

/** Tells the open app windows what was just installed; each reloads when its user is not mid-typing (stores/state). */
function announceUpdate(clients, version) {
  for (const client of clients) client.postMessage({ type: 'app-updated', version });
}

let checking = null;

/** Asks every origin for its bundle; installs the newest genuine one above the running version. */
function checkUpdates(origins) {
  // A check in flight may ask fewer machines (a page load asks only this one): ask ours once it is done.
  if (checking && origins.length) {
    const again = () => checkUpdates(origins);
    return checking.then(again, again);
  }
  checking ??= (async () => {
    const running = await current();
    const candidates = [];
    const log = [];
    for (const origin of new Set([location.origin, ...origins])) {
      try {
        const res = await fetch(`${origin}/api/bundle`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = await verifyOffer(await res.json(), RELEASE_KEYS, origin === location.origin);
        candidates.push({ origin, manifest });
      } catch (err) {
        log.push(`${origin}: ${err.message}`);
      }
    }
    const best = pickNewest(candidates, running?.version);
    if (!best) return { updated: false, version: running?.version ?? null, log };
    const meta = await install(best);
    if (running) announceUpdate(await self.clients.matchAll({ type: 'window' }), meta.version); // an upgrade, not the first install
    return { updated: true, version: meta.version, from: best.origin, log };
  })().finally(() => (checking = null));
  return checking;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .catch(() => {})
      .then(() => checkUpdates([]).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL && k !== META && !k.startsWith('shub-app-')).map((k) => caches.delete(k)),
        ),
      )
      .then(async () => {
        // Windows an older loader controlled now run behind this one: tell them. A first visit has none.
        const old = await self.clients.matchAll({ type: 'window' });
        await self.clients.claim();
        announceUpdate(old, (await current())?.version);
      }),
  );
});

// The page asks after start, every half hour and when a machine reports a new version: { type, origins }.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'update-check') return;
  const reply = (msg) => (event.ports[0] ?? event.source)?.postMessage(msg);
  event.waitUntil(
    checkUpdates(event.data.origins ?? []).then(reply, (err) => reply({ updated: false, error: err.message })),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (LOADER_FILES.includes(url.pathname)) return;
  event.respondWith(serve(event, req, url));
});

async function serve(event, req, url) {
  // The page itself always comes fresh from the machine the app was installed from (hashed assets follow it);
  // the cached bundle only answers when that machine is off or slow, so a phone can never stay on an old UI.
  if (req.mode === 'navigate') {
    try {
      const res = await fetch(req, { cache: 'no-cache', signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        event.waitUntil(checkUpdates([]).catch(() => {}));
        return res;
      }
    } catch {}
  }
  const running = await current();
  if (running) {
    // Every page route is the one index.html; /pair/<code> too.
    const path = req.mode === 'navigate' ? '/index.html' : url.pathname;
    const hit = await (await caches.open(running.cache)).match(path);
    if (hit) return hit;
  }
  // No bundle yet (dev build) or a file outside it: network first, the small shell when offline.
  try {
    const res = await fetch(req);
    if (res.ok && SHELL_FILES.includes(req.mode === 'navigate' ? '/' : url.pathname)) {
      const copy = res.clone();
      void caches.open(SHELL).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
    }
    return res;
  } catch {
    const hit = await caches.match(req.mode === 'navigate' ? '/' : req);
    return hit ?? Response.error();
  }
}

// Payload: { title, body, tag, url, origin, machine }. Same tag replaces the previous notification for that session.
// `origin` is the machine that sent it; a tap opens the app on that machine.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(machineTitle(data), {
      body: data.body || '',
      tag: data.origin ? `${data.origin} ${data.tag}` : data.tag,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/', origin: data.origin },
    }),
  );
});

/** "Session name · pc" when another machine sent it. */
function machineTitle(data) {
  const title = data.title || 'shub';
  if (!data.origin || data.origin === location.origin) return title;
  return `${title} · ${data.machine || new URL(data.origin).hostname.split('.')[0]}`;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, origin } = event.notification.data || {};
  const link = new URL(url || '/', location.origin);
  // Also for this page's own machine: the app may be showing another one right now.
  if (origin) link.searchParams.set('machine', origin);
  const target = link.href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === location.origin);
      if (win) return win.focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : w));
      return self.clients.openWindow(target);
    }),
  );
});
