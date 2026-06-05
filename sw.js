// Service Worker — Offline-Betrieb für den Toxikologie-Detektiv.
// Cache-first: nach dem ersten Laden funktioniert die App ohne Netz
// (wichtig bei schwachem Schul-WLAN, wenn viele Geräte gleichzeitig laden).

const CACHE = 'toxdetektiv-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './imageProcessing.js',
  './photos/manifest.json',
  './photos/t000.png',
  './photos/t030.png',
  './photos/t060.png',
  './photos/t180.png',
  './photos/t300.png',
  './photos/t900.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // einzeln cachen, damit ein fehlgeschlagener Eintrag die Installation nicht abbricht
    await Promise.allSettled(ASSETS.map(url => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const resp = await fetch(event.request);
      // erfolgreiche GET-Antworten zusätzlich cachen
      if (resp && resp.status === 200) {
        const copy = resp.clone();
        const cache = await caches.open(CACHE);
        cache.put(event.request, copy).catch(() => {});
      }
      return resp;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
