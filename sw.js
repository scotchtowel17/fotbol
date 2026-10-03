// Offline play (ROADMAP Next 9). Network first, so a visit online always gets the newest files (no build step, no
// version to bump); every same-origin GET it answers is stored, and offline the stored copy is served. On install it
// stores every file of the app (offline.json, written by scripts/build-offline.mjs and kept current by npm run check),
// so screens never opened online still work offline. Nothing leaves the device: it only ever fetches this site.

const CACHE = 'fotbol-v1';
const LIST = 'offline.json';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(LIST, { cache: 'no-store' });
      const { files = [] } = await res.json();
      // One by one, so a single missing file never stops the rest (addAll is all or nothing).
      await Promise.all(['./', ...files].map(async (f) => {
        try {
          const r = await fetch(f, { cache: 'no-store' });
          if (r.ok) await cache.put(f, r);
        } catch { /* offline or gone: cached on first use instead */ }
      }));
    } catch { /* no list: everything is cached as it is used */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = (await cache.match('./')) ?? (await cache.match('index.html'));
        if (page) return page;
      }
      throw err;
    }
  })());
});
