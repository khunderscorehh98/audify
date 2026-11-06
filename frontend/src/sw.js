import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, CacheOnly } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { RangeRequestsPlugin } from 'workbox-range-requests';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// App shell: opens with no signal.
precacheAndRoute(self.__WB_MANIFEST);

// Firebase serves its sign-in handler from /__/auth/. If the app shell answered
// that navigation, Google sign-in would silently break, so /__/ is excluded.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/__\//, /^\/offline-audio\//],
  }),
);

// Saved songs. The page stores each whole file under a stable, query-free URL,
// so changing presigned links don't matter. Range support is what lets iOS
// Safari play from the cache.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/offline-audio/'),
  new CacheOnly({
    cacheName: 'audify-audio',
    plugins: [new CacheableResponsePlugin({ statuses: [200] }), new RangeRequestsPlugin()],
  }),
);

// Artwork. Presigned URLs change on every request, so the query string is
// removed from the cache key; each image downloads once per device.
registerRoute(
  ({ url, request }) =>
    request.destination === 'image' && url.origin !== self.location.origin && url.pathname.includes('artwork/'),
  new CacheFirst({
    cacheName: 'audify-artwork',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 600, purgeOnQuotaError: true }),
      {
        cacheKeyWillBeUsed: async ({ request }) => {
          const url = new URL(request.url);
          url.search = '';
          return url.href;
        },
      },
    ],
  }),
);
