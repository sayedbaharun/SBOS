// SB-OS Service Worker
const CACHE_NAME = 'sb-os-v5';
const STATIC_CACHE = 'sbos-static-v5';
const DYNAMIC_CACHE = 'sbos-dynamic-v5';

// Assets to cache immediately on install (static assets only, NOT HTML routes)
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.log('[SW] Cache install failed:', err))
  );
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => !currentCaches.includes(key))
            .map((key) => {
              console.log('[SW] Removing old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - network first for HTML and API, cache first for static assets only
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return;

  // Skip external font requests (Google Fonts) - let browser handle directly
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return;

  // API requests - network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML navigation requests - ALWAYS network first to get latest app version
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // JS/CSS bundles with Vite content hash in filename - cache forever (immutable).
  // Vite uses base64url chars (A-Z, a-z, 0-9, _, -) not just hex, so broaden the regex.
  if (url.pathname.match(/[-_][A-Za-z0-9_-]{6,}\.(js|css)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Other static assets - network first with cache fallback.
  // Do NOT cache /assets/* in the dynamic cache — stale hashed bundles cause MIME errors on redeploy.
  event.respondWith(networkFirst(request, url.pathname.startsWith('/assets/')));
});

// Network first strategy (for API calls and non-immutable assets).
// skipCache=true prevents stale hashed assets from being stored in the dynamic cache.
async function networkFirst(request, skipCache = false) {
  try {
    const response = await fetch(request);

    // Cache successful responses unless caller opted out
    if (response.ok && !skipCache) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    // Fallback to cache if network fails
    const cached = await caches.match(request);
    if (cached) return cached;

    // Return offline response for API
    return new Response(
      JSON.stringify({ error: 'Offline', message: 'No network connection' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Cache first strategy (for static assets)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);

    // Cache successful responses
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    // Return offline page if available
    const offlinePage = await caches.match('/');
    if (offlinePage) return offlinePage;

    return new Response('Offline', { status: 503 });
  }
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
