/**
 * 알림 표시 시간 설정 (기기별). 기본 5초, 0 = 누를 때까지 화면에 남김.
 *
 * 앱 안 알림(오른쪽 아래 카드·앱이 켜져 있을 때의 OS 알림)은 localStorage 값을 바로 쓰고,
 * 앱을 닫아도 오는 알림(서비스 워커)은 localStorage를 못 읽으므로 같은 값을
 * Cache Storage('/__sj/notify-prefs')에 복사해 서비스 워커가 읽게 한다.
 */

const KEY = 'sj-notify-duration-sec'
const CACHE = 'sj-settings'
const CACHE_PATH = '/__sj/notify-prefs'

export const DEFAULT_NOTIFY_SECONDS = 5
export const NOTIFY_SECONDS_OPTIONS = [3, 5, 10, 30, 0] as const

export function getNotifySeconds(): number {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_NOTIFY_SECONDS
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 && n <= 600 ? n : DEFAULT_NOTIFY_SECONDS
  } catch {
    return DEFAULT_NOTIFY_SECONDS
  }
}

export function setNotifySeconds(sec: number): void {
  try {
    window.localStorage.setItem(KEY, String(sec))
  } catch {
    /* 저장 실패해도 이번 화면 값은 유지 */
  }
  void syncNotifyPrefsToServiceWorker()
}

/** 서비스 워커가 읽을 수 있게 현재 설정을 Cache Storage에 복사한다 (실패는 무시). */
export async function syncNotifyPrefsToServiceWorker(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(CACHE)
    await cache.put(
      CACHE_PATH,
      new Response(JSON.stringify({ seconds: getNotifySeconds() }), { headers: { 'Content-Type': 'application/json' } })
    )
  } catch {
    /* 지원 안 되는 환경은 서비스 워커 기본값(5초) 사용 */
  }
}

export function notifySecondsLabel(sec: number): string {
  return sec === 0 ? '누를 때까지' : `${sec}초`
}
