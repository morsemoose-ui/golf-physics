// GreenDrive service worker — app shell + CDN libs cached for offline,
// satellite map tiles cached as you view them (golf courses have bad signal).
const SHELL_CACHE = 'greendrive-shell-v11';
const TILE_CACHE = 'greendrive-tiles-v1';
const MAX_TILES = 600;

const SHELL_ASSETS = [
    './',
    './index.html',
    './physics.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/lucide@1.18.0',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then(cache =>
            // Cache each asset individually so one CDN hiccup doesn't fail the whole install.
            Promise.allSettled(SHELL_ASSETS.map(url =>
                fetch(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' })
                    .then(res => cache.put(url, res))
            ))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== SHELL_CACHE && k !== TILE_CACHE)
                .map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

async function trimTileCache() {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) {
        await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
    }
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;

    // Map tiles: cache-first, fill cache as you pan around your course.
    if (url.hostname.includes('arcgisonline.com')) {
        event.respondWith(
            caches.open(TILE_CACHE).then(async cache => {
                const hit = await cache.match(event.request);
                if (hit) return hit;
                const res = await fetch(event.request);
                cache.put(event.request, res.clone());
                trimTileCache();
                return res;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    // Everything else: cache-first with network fallback (and backfill the cache).
    event.respondWith(
        caches.match(event.request, { ignoreSearch: url.origin === self.location.origin }).then(hit => {
            if (hit) return hit;
            return fetch(event.request).then(res => {
                const copy = res.clone();
                caches.open(SHELL_CACHE).then(cache => cache.put(event.request, copy));
                return res;
            });
        })
    );
});
