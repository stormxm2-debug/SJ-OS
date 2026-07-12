/**
 * 앱 내부 이벤트 → 알림센터(우하단 토스트 + OS 알림) 전달용 로컬 버스.
 *
 * NotificationCenter는 DB 실시간 이벤트(고객등록·리드) 외에 이 버스도 구독한다.
 * 백그라운드 작업(예: 청구비서 분석 완료)처럼 서버 이벤트가 없는 로컬 완료
 * 알림을 같은 토스트/OS 알림 파이프라인으로 흘려보내기 위한 최소 장치.
 */

export interface LocalNotice {
  title: string
  body: string
  /** 토스트/OS 알림 클릭 시 이동할 라우트. */
  target: 'claim-assistant' | 'registration-admin' | 'customer' | 'leads'
}

type Listener = (n: LocalNotice) => void

const listeners = new Set<Listener>()

export function subscribeLocalNotifications(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function pushLocalNotification(n: LocalNotice): void {
  for (const fn of listeners) {
    try {
      fn(n)
    } catch {
      /* 한 리스너의 오류가 다른 리스너를 막지 않게 */
    }
  }
}
