const CACHE_NAME = 'planflow-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap'
];

// Install Event - cache core assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate Event - clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Event - network first with cache fallback
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
      }
      return response;
    }).catch(() => {
      return caches.match(e.request);
    })
  );
});

// ============================================================
// MESSAGE EVENT — triggered by main thread to show notification
// This fires even when the app tab is in the background
// ============================================================
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = e.data;
    e.waitUntil(
      self.registration.showNotification(title, {
        body: body,
        tag: tag,
        requireInteraction: true,   // stays on screen until user dismisses
        silent: false,
        vibrate: [400, 200, 400, 200, 400],  // buzz pattern on mobile
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="%236366f1" stroke="%236366f1" stroke-width="1"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none"/></svg>',
        badge: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="%236366f1"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>',
        actions: [
          { action: 'dismiss', title: '✓ Dismiss' },
          { action: 'snooze',  title: '💤 Snooze 5m' }
        ]
      })
    );
  }
});

// ============================================================
// NOTIFICATION CLICK — focus the app when notification is tapped
// ============================================================
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'snooze') {
    // Snooze action: re-show after 5 minutes
    e.waitUntil(
      new Promise((resolve) => {
        setTimeout(() => {
          self.registration.showNotification(e.notification.title, {
            body: e.notification.body,
            tag: e.notification.tag + '_snooze',
            requireInteraction: true,
            silent: false,
            vibrate: [400, 200, 400, 200, 400]
          }).then(resolve);
        }, 5 * 60 * 1000);
        resolve();
      })
    );
    return;
  }

  // On tap or Dismiss — open/focus the app window
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
