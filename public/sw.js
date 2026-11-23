/* GaspiracyAI service worker — minimal and safe.
 *
 * What it does: cache-first for same-origin static assets only
 * (.js/.css/images/fonts). This is what makes the app installable
 * and lets repeat visits load the shell from cache.
 *
 * What it NEVER touches:
 *  - /api/* requests (Gemini chat, SSE streaming at /api/chat-stream,
 *    voice/transcription) — these always go straight to the network.
 *  - Navigations (/, /index.html) — always fresh from the network so a
 *    new deploy is picked up immediately, never a stale app shell.
 *  - Non-GET requests and cross-origin requests.
 *
 * Bump CACHE_NAME whenever this file's caching behavior changes; the
 * activate handler clears older caches.
 */

const CACHE_NAME = 'gaspiracyai-pwa-v1';

const STATIC_ASSET = /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only same-origin GET requests for static assets. Everything else
  // (API calls, streaming, navigations, POSTs, cross-origin) passes
  // through to the network untouched.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!STATIC_ASSET.test(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
