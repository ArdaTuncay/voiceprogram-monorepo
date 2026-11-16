/* Zircle service worker.
 *
 * Only shows the notifications the server pushes while Zircle is closed (a
 * DM or an @mention — see the backend's Backend.Push) and opens the right
 * place when one is clicked. It caches nothing on purpose: every load still
 * comes from the network, so a deploy is never hidden behind a stale copy.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Zircle', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      data: { open: data.open || null },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const open = (event.notification.data && event.notification.data.open) || null;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin);

      if (client) {
        await client.focus();
        if (open) client.postMessage({ type: 'zircle:open', open });
        return;
      }
      await self.clients.openWindow(open ? `/?open=${encodeURIComponent(open)}` : '/');
    })()
  );
});
