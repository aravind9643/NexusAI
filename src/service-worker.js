const CACHE_NAME = 'nexus-ai-cache-v1';

self.addEventListener('install', (event) => {
  // Skip waiting to activate the service worker immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Basic pass-through for now, can add caching later
  event.respondWith(fetch(event.request));
});
