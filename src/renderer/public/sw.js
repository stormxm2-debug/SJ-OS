/* SJ 웹 푸시 서비스 워커. 앱이 닫혀 있어도 서버가 보낸 알림을 OS 알림으로 띄운다. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'SJ', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'SJ'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      // 누르거나 닫을 때까지 화면에 남긴다(자동으로 사라지지 않음).
      requireInteraction: true,
      icon: '/sj-icon-512.png',
      badge: '/sj-icon-512.png',
      data: { url: data.url || '/' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    })
  )
})
