// Hash router: #/, #/g, #/p/<projectId>[/<sessionId>], #/styleguide, #/settings/...
export type Route =
  | { name: 'home' }
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
    case 'settings':
      return { name: 'settings', rest: parts.slice(1) };
    default:
      return { name: 'home' };
  }
}

export const router = $state({ route: parseHash(location.hash) });

window.addEventListener('hashchange', () => (router.route = parseHash(location.hash)));

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
