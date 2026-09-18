/* AI鑑定ノート Service Worker
   ⚠️ ファイルを更新したら、必ず CACHE の版を上げること（上げないと古い画面が出続ける）
   通信はネットワーク優先。オフラインのときだけキャッシュを返す */
const CACHE = 'kantei-note-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './assets/style.css', './assets/data.js', './assets/core.js', './assets/store.js', './assets/app.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
