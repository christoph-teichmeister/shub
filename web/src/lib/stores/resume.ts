/** Calls `fn` when the page comes back (tab visible, restored from the bfcache) or the network returns. A phone that slept keeps sockets that look open but are dead. */
export function onResume(fn: () => void): () => void {
  const visible = () => document.visibilityState === 'visible' && fn();
  document.addEventListener('visibilitychange', visible);
  const shown = (e: PageTransitionEvent) => e.persisted && fn();
  addEventListener('pageshow', shown);
  addEventListener('online', fn);
  return () => {
    document.removeEventListener('visibilitychange', visible);
    removeEventListener('pageshow', shown);
    removeEventListener('online', fn);
  };
}
