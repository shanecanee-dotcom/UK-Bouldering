// UK Boulders service worker: makes the app usable with little or no signal.
//
// - App files and crag data: network first (so updates arrive), falling back to the cache
//   after a short timeout when the signal is poor or absent.
// - Map tiles and photos: cache first. Only tiles you've actually viewed are kept;
//   we never bulk-download tiles, per the OpenStreetMap tile usage policy.
// - Photo search results: network first, falling back to the cache.
// - Weather is cached by the app itself (localStorage), so it's passed straight through here.
//
// Bump VERSION whenever the list of app files changes.

const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const TILES = "tiles";
const PHOTOS = "photos";
const API = "photo-api";

const SHELL_FILES = [
  "./",
  "index.html",
  "app.js",
  "conditions.js",
  "styles.css",
  "data/areas.js",
  "data/walkins.js",
  "data/osm.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
];

const LIMITS = { [TILES]: 2500, [PHOTOS]: 300, [API]: 100 };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // "reload" skips the browser's HTTP cache so a new version never starts with stale files
      .then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(cacheFirst(req, TILES));
  } else if (url.hostname === "upload.wikimedia.org") {
    event.respondWith(cacheFirst(req, PHOTOS));
  } else if (url.hostname === "commons.wikimedia.org" && url.pathname.endsWith("/api.php")) {
    event.respondWith(networkFirst(req, API, 5000));
  } else if (url.origin === self.location.origin || url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(networkFirst(req, SHELL, 3000, req.mode === "navigate"));
  }
  // Everything else (weather API, outbound links) goes straight to the network.
});

// Fetch cross-origin images with CORS so the cache stores a normal response. "Opaque" no-cors
// responses work too, but browsers count each one as several MB against the storage quota.
function corsRequest(req) {
  return new Request(req.url, { mode: "cors", credentials: "omit" });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(corsRequest(req));
    if (res.ok) {
      await cache.put(req.url, res.clone());
      trim(cacheName);
    }
    return res;
  } catch {
    return fetch(req); // let the page see the normal failure
  }
}

async function networkFirst(req, cacheName, timeoutMs, isNavigation = false) {
  const cache = await caches.open(cacheName);
  // Page loads may carry a ?query: cache them under the address without it
  const url = new URL(req.url);
  if (isNavigation) url.search = "";
  const key = url.href;

  // Our own files: ask the server every time ("no-cache" revalidates, so it's a tiny 304 when
  // nothing changed). Otherwise the browser's HTTP cache (GitHub Pages allows 10 minutes) can hand
  // us an old app.js, which we'd then save and keep serving.
  const own = url.origin === self.location.origin;
  const request = !own ? req : isNavigation
    ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(req, { cache: "no-cache" });

  let servedCache = false;
  const network = fetch(request).then(async (res) => {
    if (res.ok) {
      const old = own ? await cache.match(key) : null;
      await cache.put(key, res.clone());
      if (LIMITS[cacheName]) trim(cacheName);
      // The page got our saved copy (slow signal) but the server has a newer one: tell the page
      if (servedCache && old && stamp(old) !== stamp(res)) notifyUpdate();
    }
    return res;
  });
  network.catch(() => {}); // offline: handled below via the cache

  // On a weak signal, don't wait forever: show the cached copy after the timeout
  // (the network response still updates the cache when it arrives).
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first && first.ok) return first;

  servedCache = true;
  const cached =
    (await cache.match(key)) ||
    // Offline page load of the app under any address in scope: fall back to the cached app page
    (isNavigation && (await cache.match(new URL("index.html", self.registration.scope).href)));
  if (cached) return cached;
  return network; // nothing cached: wait for the network (or fail)
}

const stamp = (res) => res.headers.get("etag") || res.headers.get("last-modified") || "";

let notified = false;
async function notifyUpdate() {
  if (notified) return;
  notified = true;
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "update-available" });
  setTimeout(() => (notified = false), 60000);
}

// Keep caches bounded: drop the oldest entries beyond the limit
let trimming = {};
async function trim(cacheName) {
  if (trimming[cacheName]) return;
  trimming[cacheName] = true;
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const excess = keys.length - (LIMITS[cacheName] || Infinity);
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } finally {
    trimming[cacheName] = false;
  }
}
