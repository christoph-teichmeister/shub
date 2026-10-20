// shub service worker: web push notifications and a minimal offline shell.
const CACHE = 'shub-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for the app itself; the cache only answers when offline. /api is never cached.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((hit) => hit ?? Response.error())),
  );
});

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
