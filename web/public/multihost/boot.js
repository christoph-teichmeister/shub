// First visit only: install the loader service worker, then reload so it serves the signed bundle.
navigator.serviceWorker.register('/multihost/sw.js', { scope: '/multihost/' }).then(() => {
  if (navigator.serviceWorker.controller) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
});
