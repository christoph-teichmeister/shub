/** Calls `fn` when the page comes back (tab visible after `minHiddenMs`, restored from the bfcache) or the network returns. A phone that slept keeps sockets that look open but are dead; a quick tab switch does not. */
export function onResume(fn: () => void, minHiddenMs = 10_000): () => void {
  let hiddenAt = Infinity;
  const visible = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (Date.now() - hiddenAt >= minHiddenMs) fn();
  };
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
