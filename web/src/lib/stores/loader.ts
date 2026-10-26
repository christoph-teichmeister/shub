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
  void reg.update().catch(() => {}); // the loader itself (sw.js) is checked as often as the bundle
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

export interface IdleState {
  /** A focused field holds text the user has not sent or saved yet. */
  unsentText: boolean;
  hidden: boolean;
  /** Milliseconds since the user last typed into a terminal. */
  terminalIdleMs: number;
}

/** Reloading into a new app must not eat input: never over unsent text, and not mid-terminal-use unless the page is hidden. */
export function canReloadNow(s: IdleState, quietMs = 30_000): boolean {
  return !s.unsentText && (s.hidden || s.terminalIdleMs >= quietMs);
}

let lastTerminalUse = 0;
export const markTerminalUse = (): number => (lastTerminalUse = Date.now());

/** Reads the live page: the focused field (xterm's hidden textarea does not count, the terminal timer covers it). */
export function idleState(): IdleState {
  const el = document.activeElement as HTMLElement | null;
  const field =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value
      : el?.isContentEditable
        ? el.textContent
        : '';
  return {
    unsentText: !el?.classList.contains('xterm-helper-textarea') && !!field?.trim(),
    hidden: document.hidden,
    terminalIdleMs: Date.now() - lastTerminalUse,
  };
}
