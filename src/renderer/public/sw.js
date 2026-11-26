/* SJ 웹 푸시 서비스 워커. 앱이 닫혀 있어도 서버가 보낸 알림을 OS 알림으로 띄운다. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// 알림 표시 시간(초) — 앱의 '알림 설정'에서 고른 값을 Cache Storage로 넘겨받는다.
// 0 = 누를 때까지 남김. 값이 없으면 5초.
async function readNotifySeconds() {
  try {
    const cache = await caches.open('sj-settings')
    const res = await cache.match('/__sj/notify-prefs')
    if (!res) return 5
    const j = await res.json()
    const n = Number(j && j.seconds)
    return Number.isFinite(n) && n >= 0 ? n : 5
  } catch {
    return 5
  }
}

// 폰은 알림이 알림창(상단 목록)에 남아야 하므로 자동으로 지우지 않는다 — PC만 시간이 지나면 닫는다.
const IS_MOBILE = /android|iphone|ipad|ipod|mobile/i.test((self.navigator && self.navigator.userAgent) || '')

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'SJ', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'SJ'
  const tag = data.tag || `sj-${Date.now()}`
  event.waitUntil(
    readNotifySeconds().then(async (seconds) => {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag,
        // 같은 건에 메모를 다시 보내도 소리·진동으로 다시 알린다 (조용히 덮어쓰기 방지)
        renotify: true,
        // 0초(누를 때까지)를 고른 PC에서만 화면에 계속 남긴다.
        requireInteraction: seconds === 0 && !IS_MOBILE,
        icon: '/sj-icon-512.png',
        badge: '/sj-icon-512.png',
        data: { url: data.url || '/' }
      })
      if (seconds > 0 && !IS_MOBILE) {
        await new Promise((r) => setTimeout(r, seconds * 1000))
        const list = await self.registration.getNotifications({ tag })
        list.forEach((n) => n.close())
      }
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
