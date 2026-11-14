// StockPilot AI service worker: offline app shell. API responses are never cached here
// (financial data must not be shown stale without its timestamp — the server handles caching).
const VERSION = "sp-v1";
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const SHELL = [`${BASE}/`, `${BASE}/offline.html`, `${BASE}/icons/icon-192.png`];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/data/")) return;
  if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; })));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((hit) => hit || caches.match(`${BASE}/offline.html`))));
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || `${BASE}/alerts/`));
});
