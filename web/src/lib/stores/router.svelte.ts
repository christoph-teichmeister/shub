// Hash router: #/, #/g, #/p/<projectId>[/<sessionId>], #/game, #/overview, #/styleguide, #/login, #/settings/...
// Plus one path route: /pair/<code> (the phone opens the QR link; the server serves index.html for it).
// Settings: #/settings[/<area>], #/settings/project/<id|new>, #/settings/theme/<id|new>, #/settings/import.
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
window.addEventListener('hashchange', (e) => {
  const old = new URL(e.oldURL).hash;
  if (!['game', 'overview'].includes(parseHash(old).name)) beforeGame = old || '#/';
  router.route = current();
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
