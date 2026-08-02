// Service Worker real: cachea el shell de la app para que Pit abra instantáneo
// (y siga abriendo, mostrando el último estado, aunque el internet se corte un segundo).
const CACHE_NAME = 'pit-shell-v1';
const SHELL_FILES = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo cacheamos el shell estático; las llamadas a /api/ y socket.io siempre van a la red.
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
