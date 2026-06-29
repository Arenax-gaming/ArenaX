// ArenaX Service Worker
// Strategies:
//   - Static/JS/CSS assets  → Cache-First (immutable)
//   - API GET requests       → Network-First, fallback to cache (5-min TTL)
//   - Everything else        → Network-First, fallback to /offline

const CACHE_VERSION = "v1";
const STATIC_CACHE = `arenax-static-${CACHE_VERSION}`;
const API_CACHE = `arenax-api-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

const PRECACHE_ASSETS = ["/", OFFLINE_URL, "/manifest.json"];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const keep = [STATIC_CACHE, API_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Static assets → Cache-First
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.match(/\.(js|css|woff2?|png|svg|ico)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API GET → Network-First, fallback to stale cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstWithCache(request, API_CACHE, 5 * 60));
    return;
  }

  // Navigation → Network-First, fallback to offline page
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }
});

// ─── Strategies ─────────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstWithCache(request, cacheName, maxAgeSecs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Stamp with fetch time for TTL enforcement
      const headers = new Headers(response.headers);
      headers.set("x-sw-fetched-at", String(Date.now()));
      const stamped = new Response(await response.clone().arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      cache.put(request, stamped);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const fetchedAt = Number(cached.headers.get("x-sw-fetched-at") ?? 0);
      if (Date.now() - fetchedAt < maxAgeSecs * 1000) return cached;
    }
    return new Response(JSON.stringify({ error: "offline", code: 503 }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}
