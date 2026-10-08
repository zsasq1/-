/* Семестр — сервис-воркер: работа без интернета и обновления.
   Файлы приложения сохраняются целиком для каждой версии. Новая версия скачивается в фоне
   и включается, только когда пользователь нажмёт «Обновить» — так страница никогда не собирается
   из файлов разных версий. VERSION пересчитывается скриптом tools/sw-version.py. */

const VERSION = 'semestr-ef334a2793';
const RUNTIME = 'semestr-runtime';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/utils.js',
  'js/data/kgmu-3-lech-2026.js',
  'js/data/kgmu-topics.js',
  'js/kgmu.js',
  'js/store.js',
  'js/ui.js',
  'js/schedule.js',
  'js/topics.js',
  'js/files.js',
  'js/notify.js',
  'js/home.js',
  'js/settings.js',
  'js/calendar.js',
  'js/cloud.js',
  'js/vendor/qrcode.min.js',
  'js/pwa.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

// Шрифты и библиотека чтения Excel — с чужих сайтов, их храним отдельно
const CDN = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('semestr-') && key !== VERSION && key !== RUNTIME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Данные «Семестра для Mac» всегда берём с диска, а не из кеша
    if (url.pathname.includes('/api/')) return;
    // Любая страница приложения — это index.html: маршруты живут после «#»
    if (req.mode === 'navigate') {
      event.respondWith(fromCache('index.html', req));
      return;
    }
    event.respondWith(fromCache(req, req));
    return;
  }

  if (CDN.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function fromCache(key, req) {
  const hit = await caches.match(key, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(RUNTIME);
    cache.put(req, res.clone());
  }
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || fallback(req));
  return hit || net;
}

// Без сети и без сохранённой копии: для стилей шрифтов отдаём пустой CSS — останутся системные шрифты
function fallback(req) {
  if (new URL(req.url).hostname === 'fonts.googleapis.com') {
    return new Response('', { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
  }
  return Response.error();
}

// Нажатие на системное уведомление открывает приложение на нужном разделе
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        client.postMessage({ type: 'open-notification', id: data.id });
        return client.focus();
      }
    }
    return self.clients.openWindow(`./${data.route ? `#${data.route === 'reminders' ? 'notifications' : data.route}` : ''}`);
  })());
});
