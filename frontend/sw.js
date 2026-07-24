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

// Sistema real de notificaciones push (bug corregido — antes no existía
// este listener): sendPushNotification() en el backend manda un payload
// real vía Web Push (VAPID), el navegador SÍ lo recibe y despierta este
// service worker con el evento 'push' — pero sin este handler, nada
// llamaba a showNotification() y la notificación nunca aparecía. Toda la
// infraestructura (claves VAPID, /subscribe, sendPushNotification) hacía
// el envío real y terminaba en la nada del lado del cliente.
self.addEventListener('push', (event) => {
  let payload = { title: 'Pit', body: 'Tenés algo nuevo' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Si por algún motivo el payload no es JSON válido, se muestra el genérico de arriba.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { chatId: payload.chatId || null, messageId: payload.messageId || null }
    })
  );
});

// Al tocar la notificación: enfocar una pestaña de Pit ya abierta si existe,
// o abrir una nueva — sin esto, tocar la notificación no hacía nada.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
