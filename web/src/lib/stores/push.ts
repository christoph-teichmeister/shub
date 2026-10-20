// Web push on this device: service worker (web/public/sw.js). A desktop browser subscribes with the machine's
// VAPID key; a phone app that knows several machines owns one VAPID pair and hands it to each machine, so every
// machine can push to the one subscription this origin can have.
import { api } from './api.ts';
import { machines } from './device.ts';

interface AppVapid {
  publicKey: string;
  privateKey: string;
}
const VAPID = 'shub.vapid';

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The app's own VAPID pair. Its private half only lets a machine send pushes to this phone. */
async function appVapid(): Promise<AppVapid> {
  const saved = localStorage.getItem(VAPID);
  if (saved) return JSON.parse(saved) as AppVapid;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const vapid = {
    publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!,
  };
  localStorage.setItem(VAPID, JSON.stringify(vapid));
  return vapid;
}

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** True when this browser already has a push subscription. */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Asks for notification permission, subscribes and registers the subscription with shub. */
export async function subscribePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser has no web push');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked');
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register('/sw.js', { type: 'module' }));
  await navigator.serviceWorker.ready;
  const list = await machines();
  if (!list.length) {
    const { publicKey } = await api<{ publicKey: string }>('pushKey');
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    await api('pushSubscribe', { body: sub.toJSON() });
    return;
  }
  const vapid = await appVapid();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a machine's key (before the app knew several) cannot take the app's key.
  const key = sub?.options.applicationServerKey;
  if (sub && (!key || b64url(key) !== vapid.publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid.publicKey) });
  const failed: string[] = [];
  for (const m of list) await sharePush(m.origin, sub).catch(() => failed.push(m.name));
  if (failed.length === list.length) throw new Error('No machine took the push subscription');
}

/** Hands this phone's subscription and the app's VAPID pair to one machine (e.g. right after adding it). */
export async function sharePush(origin: string, sub?: PushSubscription | null): Promise<void> {
  sub ??= await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await api('pushSubscribe', { origin, body: { ...sub.toJSON(), vapid: await appVapid() } });
}
