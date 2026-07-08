/* lifeOS service worker — cache the app shell so capture works offline-ish.
   Network-first for API; cache-first for static shell. */
const CACHE = 'lifeos-v48';
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
// Plan tab reminders (server-scheduled, see server/notify.js) arrive here even when no tab is open.
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || 'lifeOS', {
    body: data.body || '', tag: data.tag || undefined, icon: '/icons/icon.svg',
    vibrate: [200, 100, 200],   // Chrome shows push notifications silently unless a pattern is given
    renotify: true,             // re-alert (incl. vibrate) even if a notification with this tag already showed
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  }));
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
