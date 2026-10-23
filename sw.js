// sw.js — FamSort service worker. Purely a SPEED + offline layer; it changes no
// behaviour. Strategy:
//   • Cache-FIRST for the heavy, effectively-immutable third-party assets — the
//     ~6 MB on-device face model + face-api library (jsDelivr/unpkg) and Google
//     Fonts. These dominate cold-load; once cached, repeat loads are instant and
//     work offline.
//   • Network-FIRST for our own app shell (HTML), so updates always land, with a
//     cached fallback so the app still opens with no connection.
// Bump CACHE_VERSION whenever you want every client to drop old caches.
const CACHE_VERSION = "famsort-v11";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// Hosts whose responses are safe to cache long-term (versioned/immutable CDNs).
const ASSET_HOSTS = [
  "cdn.jsdelivr.net",
  "unpkg.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

self.addEventListener("install", (event) => {
  // Activate this version immediately rather than waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions so we never serve stale bundles.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isAssetHost(url) {
  return ASSET_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Heavy third-party assets (model, library, fonts): cache-first.
  if (isAssetHost(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          // Only cache successful, non-opaque-error responses.
          if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
          return res;
        } catch (e) {
          const any = await cache.match(req);
          if (any) return any;
          throw e;
        }
      })()
    );
    return;
  }

  // Our own app shell / navigations: network-first, fall back to cache offline.
  if (req.mode === "navigate" || url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          const hit = await cache.match(req);
          if (hit) return hit;
          // Last resort for a navigation with nothing cached yet.
          if (req.mode === "navigate") {
            const index = await cache.match("./") || await cache.match("index.html");
            if (index) return index;
          }
          throw e;
        }
      })()
    );
  }
});
