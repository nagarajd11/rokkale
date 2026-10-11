// RokkaLE PWA Service Worker - Network First with Auto-Purge
const CACHE_NAME = 'rokkale-cache-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key)) // delete all old caches!
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy so updates always show immediately
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
