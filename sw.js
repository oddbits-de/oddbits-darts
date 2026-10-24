const CACHE = "oddbits-darts-v0.6.1";
const FILES = [
  "./",
  "index.html",
  "style.css?v=0.6.1",
  "js/app.js?v=0.6.1",
  "js/modes.js",
  "js/rules.js",
  "js/stats.js",
  "js/db.js",
  "js/checkout.js",
  "js/bot.js",
  "js/i18n.js",
  "manifest.webmanifest",
  "assets/favicon.svg",
  "assets/favicon-32.png",
  "assets/favicon.ico",
  "assets/apple-touch-icon.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "fonts/barlow-condensed-700.woff2",
  "fonts/barlow-condensed-700-italic.woff2",
  "fonts/ibm-plex-sans-400.woff2",
  "fonts/ibm-plex-sans-600.woff2",
  "fonts/ibm-plex-mono-400.woff2",
  "fonts/ibm-plex-mono-500.woff2"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("oddbits-darts-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data === "version" && event.source) event.source.postMessage({ version: CACHE });
});

// Netz zuerst, damit Updates ankommen; ohne Netz (oder nach 3 s) aus dem Cache. Die App lädt nie von selbst neu, ein laufendes Leg bleibt also unberührt.
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req, { cache: "no-cache" }).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (e) {}
    const cached = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    return cached || network;
  })());
});
