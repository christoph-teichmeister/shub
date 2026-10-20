// Multi-host spike app v__VERSION__ (served by the loader from the signed bundle).
const $ = (id) => document.getElementById(id);
const logLine = (msg) => ($('log').textContent = `${new Date().toLocaleTimeString()} ${msg}\n` + $('log').textContent);
const load = (k, d) => JSON.parse(localStorage.getItem(k) ?? 'null') ?? d;
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const hosts = () => load('mh.hosts', []);
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
$('origin').textContent = location.origin;

async function call(host, method, path, body) {
  const res = await fetch(`${host.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${host.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
  return res.json();
}

async function pair(link) {
  const url = new URL(link.trim());
  const code = url.pathname.split('/pair/')[1];
  if (!code) throw new Error('not a pairing link');
  const res = await fetch(`${url.origin}/api/auth/pairing/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceName: 'multi-host test app', bearer: true }),
  });
  if (!res.ok) throw new Error(`pairing failed: HTTP ${res.status} ${await res.text()}`);
  const { token } = await res.json();
  save('mh.hosts', [...hosts().filter((h) => h.url !== url.origin), { url: url.origin, token }]);
  logLine(`paired ${url.origin}`);
  const reg = load('mh.push', null);
  if (reg)
    await registerPush(
      hosts().find((h) => h.url === url.origin),
      reg,
    );
  render();
}

function render() {
  $('hosts').innerHTML = '';
  for (const host of hosts()) {
    const el = document.createElement('div');
    el.className = 'host';
    el.innerHTML = `<b></b><div class="muted status">checking…</div>
      <button data-a="ws">WebSocket</button><button data-a="push">Push in 10 s</button><button data-a="rm">Remove</button>`;
    el.querySelector('b').textContent = host.url;
    $('hosts').append(el);
    fetch(`${host.url}/api/health`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((h) => (el.querySelector('.status').textContent = `online, shub ${h.version}`))
      .catch((e) => (el.querySelector('.status').textContent = `offline (${e.message})`));
    el.onclick = (ev) => {
      const a = ev.target.dataset?.a;
      if (a === 'rm')
        return (
          save(
            'mh.hosts',
            hosts().filter((h) => h.url !== host.url),
          ),
          render()
        );
      if (a === 'ws') return testSocket(host);
      if (a === 'push')
        return call(host, 'POST', '/api/spike/push/test', { delaySeconds: 10 })
          .then((r) => logLine(`${host.url}: push in 10 s to ${r.count} subscription(s), close the app now`))
          .catch((e) => logLine(`${host.url}: push failed: ${e.message}`));
    };
  }
}

function testSocket(host) {
  const ws = new WebSocket(`${host.url.replace(/^http/, 'ws')}/api/events`, ['shub', `bearer.${host.token}`]);
  const timer = setTimeout(() => (logLine(`${host.url}: WebSocket timeout`), ws.close()), 8000);
  ws.onmessage = (m) => {
    clearTimeout(timer);
    logLine(`${host.url}: WebSocket ok, first message ${m.data.slice(0, 60)}`);
    ws.close();
  };
  ws.onerror = () => (clearTimeout(timer), logLine(`${host.url}: WebSocket error`));
}

/** One VAPID pair and one subscription for the whole app; every host gets both. */
async function enablePush() {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications blocked');
  let reg = load('mh.push', null);
  if (!reg) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
    const raw = await crypto.subtle.exportKey('raw', keys.publicKey);
    const sw = await navigator.serviceWorker.ready;
    const old = await sw.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    reg = { subscription: sub.toJSON(), publicKey: b64url(raw), privateKey: jwk.d };
    save('mh.push', reg);
  }
  for (const host of hosts()) await registerPush(host, reg);
}

async function registerPush(host, reg) {
  try {
    await call(host, 'POST', '/api/spike/push', reg);
    logLine(`${host.url}: push registered`);
  } catch (e) {
    logLine(`${host.url}: push registration failed: ${e.message}`);
  }
}

$('add').onclick = () =>
  pair($('pair').value)
    .then(() => ($('pair').value = ''))
    .catch((e) => logLine(e.message));
$('push').onclick = () => enablePush().catch((e) => logLine(`push: ${e.message}`));
$('update').onclick = async () => {
  const sw = await navigator.serviceWorker.ready;
  sw.active.postMessage({
    type: 'check-updates',
    hosts: [...new Set([location.origin, ...hosts().map((h) => h.url)])],
  });
  logLine('checking for updates…');
};
navigator.serviceWorker.addEventListener('message', (m) => {
  if (m.data?.type !== 'update-log') return;
  m.data.log.forEach(logLine);
  if (m.data.log.some((l) => l.startsWith('installed'))) setTimeout(() => location.reload(), 1500);
});

const hashPair = new URLSearchParams(location.hash.slice(1)).get('pair');
if (hashPair) {
  history.replaceState(null, '', location.pathname);
  pair(hashPair).catch((e) => logLine(e.message));
}
render();
