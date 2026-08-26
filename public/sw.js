// VrikshaFX service worker — app-shell + asset caching for offline PWA use.
//
// Deliberately no hand-maintained precache list: routes get added as
// modules ship, and a static list would silently go stale. Instead this
// caches opportunistically as pages/assets are visited online, so anything
// you've opened once is available offline afterwards.
//
// Bump CACHE_VERSION whenever caching behavior changes, to invalidate old caches.
const CACHE_VERSION = "v2";
const CACHE_NAME = `vrikshafx-${CACHE_VERSION}`;

// The one route worth precaching: it is the fallback shown when a navigation
// fails offline and the target was never visited, so it must be in the cache
// before it is ever needed. Resolved against the SW's own URL so it picks up
// the GitHub Pages basePath automatically.
const OFFLINE_URL = new URL("./offline", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Never let a failed precache block activation - the app still works
      // online, and the fallback will be cached on the next install.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch(() => undefined);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await cache.match(OFFLINE_URL);
    if (fallback) return fallback;
    return new Response("You are offline and this page has not been cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await networkFetch) ?? Response.error();
}
