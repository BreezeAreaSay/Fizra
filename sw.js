// Сервис-воркер хранит копию кнопки на телефоне, чтобы она открывалась даже без интернета:
// геолокации (GPS) и SMS интернет не нужен.
const CACHE = 'sos-fizra-v1';
const FILES = [
  './',
  './index.html',
  './app.js',
  './phone.js',
  './style.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Сначала отдаём сохранённую копию (мгновенно и офлайн), а в фоне обновляем её из сети.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  // Параметры ссылки (?p=…&g=…) на содержимое файлов не влияют — храним одну копию.
  url.search = '';
  const key = url.href;

  const update = caches.open(CACHE).then((cache) =>
    fetch(event.request).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    }),
  );
  event.waitUntil(update.catch(() => {}));
  event.respondWith(caches.match(key).then((cached) => cached || update));
});
