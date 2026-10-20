// The app loader in the service worker (web/public/sw.js): it serves the app from a cached bundle and swaps in a
// newer genuine one from any machine this phone knows.

export interface UpdateCheck {
  updated: boolean;
  version: string | null;
  from?: string;
  log?: string[];
  error?: string;
}

export function registerLoader(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(undefined);
  return navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(() => undefined);
}

/** Asks the loader to look at every origin's bundle; resolves with what it did (never throws). */
export async function checkAppUpdate(origins: string[]): Promise<UpdateCheck> {
  const none: UpdateCheck = { updated: false, version: null };
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (!reg?.active) return none;
  const worker = reg.active;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(none), 120_000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as UpdateCheck);
    };
    worker.postMessage({ type: 'update-check', origins }, [channel.port2]);
  });
}
