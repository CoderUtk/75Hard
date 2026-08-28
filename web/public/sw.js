/* Service worker: Phase 5a push + Phase 5b install.
   No precache, no Workbox — the offline handler below is only a courtesy
   page for a lost connection; the app itself needs the network. */

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline — 75 Hard</title>' +
  '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
  'background:#0A0A0A;color:#fafafa;font-family:system-ui,sans-serif;text-align:center">' +
  '<div><p style="font-size:1.1rem">You’re offline.</p>' +
  '<p style="color:#a1a1aa">75 Hard needs a connection. Reconnect and reopen.</p></div>';

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }
  const title = data.title || '75 Hard';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      tag: data.tag || 'nudge',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin)) return w.focus();
      }
      return self.clients.openWindow('/today');
    }),
  );
});
