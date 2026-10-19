// Web push on this device: service worker (web/public/sw.js) + VAPID key from the server.
import { api } from './api.ts';

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
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('pushKey');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api('pushSubscribe', { body: sub.toJSON() });
}
