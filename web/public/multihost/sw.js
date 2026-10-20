// Multi-host spike loader. Only this file comes from the install origin; the app (app.html + app.js) is a
// bundle fetched from any paired host and accepted only with a valid ed25519 signature. Newest version wins.
const PUBLIC_KEY = 'e6b6FoNuE5wznpk2X0fvfHCLdcgMpJSRpTFN7QRTPUY'; // gitleaks:allow (public key)
const CACHE = 'mh-bundle';
const TYPES = { 'app.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8' };

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const keyPromise = crypto.subtle.importKey('raw', b64(PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);

async function currentVersion() {
  const hit = await (await caches.open(CACHE)).match('/multihost/version');
  return hit ? Number(await hit.text()) : 0;
}

/** Fetches and verifies a host's bundle. Returns { version } or throws with the reason. */
async function fetchBundle(host) {
  const res = await fetch(`${host}/api/spike/bundle`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { bundle, signature } = await res.json();
  const ok = await crypto.subtle.verify('Ed25519', await keyPromise, b64(signature), new TextEncoder().encode(bundle));
  if (!ok) throw new Error('bad signature, refused');
  return JSON.parse(bundle);
}

async function install(bundle) {
  const cache = await caches.open(CACHE);
  for (const [name, body] of Object.entries(bundle.files)) {
    await cache.put(`/multihost/${name}`, new Response(body, { headers: { 'content-type': TYPES[name] } }));
  }
  await cache.put('/multihost/version', new Response(String(bundle.version)));
}

/** Asks every host; installs the newest valid bundle that is newer than the cached one. */
async function checkUpdates(hosts) {
  const log = [];
  let best = null;
  for (const host of hosts) {
    try {
      const bundle = await fetchBundle(host);
      log.push(`${host}: v${bundle.version}, signature ok`);
      if (!best || bundle.version > best.version) best = bundle;
    } catch (err) {
      log.push(`${host}: ${err.message}`);
    }
  }
  const current = await currentVersion();
  if (best && best.version > current) {
    await install(best);
    log.push(`installed v${best.version} (was v${current})`);
  } else log.push(`staying on v${current}`);
  return log;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetchBundle(location.origin)
      .then(install)
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  const name = event.request.mode === 'navigate' && url.pathname.startsWith('/multihost/') ? 'app.html' : null;
  const path = name ? `/multihost/${name}` : url.pathname;
  if (!name && !['/multihost/app.js', '/multihost/version'].includes(path)) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((c) => c.match(path))
      .then((hit) => hit ?? fetch(event.request)),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'check-updates') {
    event.waitUntil(
      checkUpdates(event.data.hosts).then((log) => event.source.postMessage({ type: 'update-log', log })),
    );
  }
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'shub', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/multihost/index.html'));
});
