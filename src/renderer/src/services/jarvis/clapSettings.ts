/**
 * 박수로 자비스 열기 — 옵트인 설정 저장소 (기기별 localStorage) + 구독.
 *
 * 항상 마이크를 듣는 기능이라 기본은 OFF. 사용자가 자비스 설정에서 켜야만
 * 동작한다(명시적 마이크 권한). 오디오는 저장하지 않고 소리 크기만 분석한다.
 * favorites와 같은 경량 pub/sub 패턴.
 */

const KEY = 'sj-jarvis-clap-v1'
type Listener = () => void
const listeners = new Set<Listener>()

export function getClapEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setClapEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* 저장 실패(사파리 프라이빗 등)여도 세션 내 동작은 유지 */
  }
  listeners.forEach((fn) => fn())
}

export function subscribeClap(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
