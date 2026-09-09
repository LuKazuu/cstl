const CACHE = 'cstl-v1.0.4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './plugins.js',
  './app.js',
  './jszip.min.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => { console.error('SW install failed:', err); throw err; })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

function withCoi(res) {
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return sameOrigin ? withCoi(cached) : cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'error') return res;
        if (sameOrigin) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(err => console.error('cache put failed:', err));
          return withCoi(res);
        }
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});
