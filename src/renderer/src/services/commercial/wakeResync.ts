import { useEffect, useState } from 'react'

/**
 * 모바일 "깨어남" 전역 재동기화.
 *
 * 폰에서 웹/PWA를 다시 열면 페이지가 새로 로드되지 않고 잠들었던 화면이 그대로
 * 깨어난다 — 그 사이 realtime 소켓은 끊겨 있고, mount 시에만 fetch하는 화면
 * (홈 대시보드 등)은 옛 데이터가 계속 보인다. 이 훅은 다음 신호에서 key를 올리고,
 * 셸(AppShell/MobileShell)이 콘텐츠를 key로 리마운트해 모든 화면이 재조회한다:
 *  - visibilitychange: HIDDEN_MS 이상 숨겨졌다 돌아옴
 *  - pageshow(persisted): bfcache 복원 (iOS 사파리/카톡 인앱 — visibilitychange 미발생 케이스)
 *  - online: 네트워크 복구
 * 수동 새로고침 버튼(bump)도 같은 경로를 쓴다.
 * 리마운트는 작성 중이던 폼을 초기화하므로 임계값(3분)을 두어 짧은 전환에는 발동하지 않는다.
 */
const HIDDEN_MS = 3 * 60 * 1000

let bumpFns: (() => void)[] = []

/** 수동 새로고침 — 셸의 새로고침 버튼이 호출. */
export function bumpWake(): void {
  for (const fn of bumpFns) fn()
}

export function useWakeKey(): { wakeKey: number; lastSyncAt: Date; refresh: () => void } {
  const [wakeKey, setWakeKey] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<Date>(() => new Date())

  useEffect(() => {
    let hiddenAt = 0
    const bump = (): void => {
      setWakeKey((k) => k + 1)
      setLastSyncAt(new Date())
    }
    bumpFns.push(bump)

    const onVisible = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt >= HIDDEN_MS) {
        hiddenAt = 0
        bump()
      }
    }
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted) bump() // bfcache 복원 = 확실히 오래된 화면
    }
    const onOnline = (): void => bump()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    return () => {
      bumpFns = bumpFns.filter((f) => f !== bump)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  return { wakeKey, lastSyncAt, refresh: bumpWake }
}
