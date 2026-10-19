// Hash router: #/, #/g, #/p/<projectId>[/<sessionId>], #/styleguide, #/login, #/settings/...
// Plus one path route: /pair/<code> (the phone opens the QR link; the server serves index.html for it).
// Settings: #/settings, #/settings/project/<id|new>, #/settings/theme/<id|new>, #/settings/import.
export type Route =
  | { name: 'home' }
  | { name: 'login' }
  | { name: 'pair'; code: string }
  | { name: 'global' }
  | { name: 'project'; projectId: string; sessionId: string | null }
  | { name: 'styleguide' }
  | { name: 'settings'; rest: string[] };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'g':
      return { name: 'global' };
    case 'p':
      return parts[1] ? { name: 'project', projectId: parts[1], sessionId: parts[2] ?? null } : { name: 'home' };
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

window.addEventListener('hashchange', () => (router.route = current()));

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
