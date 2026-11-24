// Hash router: #/, #/g, #/p/<projectId>[/<sessionId>], #/game, #/overview, #/styleguide, #/login, #/settings/...
// Plus one path route: /pair/<code> (the phone opens the QR link; the server serves index.html for it).
// Settings: #/settings[/<area>], #/settings/project/<id|new>, #/settings/theme/<id|new>, #/settings/import.
import { tick } from 'svelte';
export type Route =
  | { name: 'home' }
  | { name: 'login' }
  | { name: 'pair'; code: string }
  | { name: 'global' }
  | { name: 'project'; projectId: string; sessionId: string | null }
  | { name: 'game' }
  | { name: 'overview' }
  | { name: 'styleguide' }
  | { name: 'settings'; rest: string[] };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'g':
      return { name: 'global' };
    case 'p':
      return parts[1] ? { name: 'project', projectId: parts[1], sessionId: parts[2] ?? null } : { name: 'home' };
    case 'game':
      return { name: 'game' };
    case 'overview':
      return { name: 'overview' };
    case 'styleguide':
      return { name: 'styleguide' };
    case 'login':
      return { name: 'login' };
    case 'settings':
      return { name: 'settings', rest: parts.slice(1) };
    default:
      return { name: 'home' };
  }
}

function current(): Route {
  const pair = /^\/pair\/([^/]+)\/?$/.exec(location.pathname);
  return pair ? { name: 'pair', code: decodeURIComponent(pair[1]) } : parseHash(location.hash);
}

export const router = $state({ route: current() });

/** The last place outside the game and the overview, where "← shub" and Alt V / Alt O go back to. */
let beforeGame = '#/';
let fade = 0;
window.addEventListener('hashchange', (e) => {
  const old = new URL(e.oldURL).hash;
  if (!['game', 'overview'].includes(parseHash(old).name)) beforeGame = old || '#/';
  const next = current();
  // Main <-> overview: the old view shrinks away at once, then the new one settles in (see tokens.css). The grid
  // mounts heavy terminals, so the exit plays before the switch to give feedback while that blocks the thread.
  const root = document.documentElement;
  const seq = ++fade;
  if (
    (next.name === 'overview') !== (parseHash(old).name === 'overview') &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    root.dataset.vt = 'leave';
    setTimeout(async () => {
      if (seq !== fade) return;
      router.route = current();
      await tick();
      requestAnimationFrame(() => {
        if (seq !== fade) return;
        root.dataset.vt = 'enter';
        setTimeout(() => seq === fade && delete root.dataset.vt, 300);
      });
    }, 130);
    return;
  }
  delete root.dataset.vt;
  router.route = next;
});
export const gameBack = () => beforeGame;

export function href(...parts: (string | null | undefined)[]): string {
  return (
    '#/' +
    parts
      .filter((p): p is string => !!p)
      .map(encodeURIComponent)
      .join('/')
  );
}

export function go(...parts: (string | null | undefined)[]): void {
  location.hash = href(...parts);
}
