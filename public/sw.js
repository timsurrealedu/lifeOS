/* lifeOS service worker — cache the app shell so capture works offline-ish.
   Network-first for API; cache-first for static shell. */
const CACHE = 'lifeos-v26';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/graph.js', '/js/inkpad.js',
  '/icons/icon.svg', '/manifest.webmanifest',
  '/vendor/katex/katex.min.css', '/vendor/katex/katex.min.js',
  '/vendor/hljs/highlight.min.js', '/vendor/hljs/theme.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/vault-files/')
      || url.pathname.startsWith('/share')) return; // always live (share = POST navigation)
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
