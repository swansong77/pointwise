/* PointWise service worker: shows web-push notifications (benefit expiry alerts). */
self.addEventListener('push', (event) => {
  let data = { title: 'PointWise', body: '', link: '/notifications' };
  try {
    data = Object.assign(data, event.data ? event.data.json() : {});
  } catch (e) {
    /* non-JSON payload: keep defaults */
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { link: data.link }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/notifications';
  // only same-origin paths are opened
  const url = new URL(link.startsWith('/') ? link : '/notifications', self.location.origin);
  event.waitUntil(self.clients.openWindow(url.href));
});
