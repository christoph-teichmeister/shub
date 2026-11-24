// Hash router: #/, #/g, #/p/<projectId>[/<sessionId>], #/game, #/overview, #/stats, #/styleguide, #/login, #/settings/...
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
  | { name: 'stats' }
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
    case 'stats':
      return { name: 'stats' };
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
window.addEventListener('hashchange', (e) => {
  const old = new URL(e.oldURL).hash;
  if (!['game', 'overview'].includes(parseHash(old).name)) beforeGame = old || '#/';
  const next = current();
  // Main <-> overview zooms (View Transitions API; skipped without it or under reduced motion, see tokens.css).
  const into = next.name === 'overview';
  if (
    into !== (parseHash(old).name === 'overview') &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    document.startViewTransition
  ) {
    document.documentElement.dataset.vt = into ? 'in' : 'out';
    const run = async () => {
      if (into) await import('../views/Overview/Overview.svelte'); // chunk ready, so the new frame is the grid, not a gap
      router.route = next;
      await tick();
      await new Promise((r) => requestAnimationFrame(r));
    };
    void document.startViewTransition(run).finished.finally(() => delete document.documentElement.dataset.vt);
    return;
  }
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
