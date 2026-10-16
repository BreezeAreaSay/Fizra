// Service worker: хранит копию приложения, чтобы кнопка SOS открывалась даже без интернета
// (геолокации и SMS интернет не нужен), и показывает уведомления о тревогах на Android.
const CACHE = 'sos-fizra-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Запросы к серверу (тревоги, список студентов) никогда не берём из кэша.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.includes('/api/')
  )
    return;

  // Страница: сначала сеть, чтобы получать обновления; без сети — сохранённая копия.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok)
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put('./', copy)),
            );
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Скрипты, стили, иконки: из кэша, а в фоне обновляем копию.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => undefined));
        return cached;
      }
      return network;
    }),
  );
});

// Нажали на уведомление о тревоге — открываем панель.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow('./');
      }),
  );
});
