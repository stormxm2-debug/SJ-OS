/**
 * 렌더 성능 모드 감지.
 *
 * Electron 데스크톱 앱은 안정성 때문에 GPU 가속을 끈 상태(main/index.ts의
 * disableHardwareAcceleration — 컴포지터 입력 잠김 버그 회피)라, GPU에 얹혀 도는
 * 화려한 그래픽(파티클 성운·블러·3D)이 소프트웨어 렌더링에서 렉을 일으킨다.
 * 웹(크롬)은 GPU가 켜져 있어 문제없다.
 *
 * 그래서 "저사양 렌더" = Electron 여부로 판단해, 앱에서만 자비스 시각효과를
 * 자동으로 가볍게 낮춘다. 웹은 그대로 풀 화려함을 유지한다.
 * Electron UA에는 항상 'Electron'이 포함된다(가장 신뢰도 높은 신호).
 */
/** Electron UA 감지 — 데스크톱 앱은 항상 UA에 'Electron'을 포함한다. */
function isElectron(): boolean {
  try {
    return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)
  } catch {
    return false
  }
}

export const LOW_PERF: boolean = (() => {
  try {
    // QA/미리보기용 강제 토글 — 웹에서도 앱의 저사양 모드를 확인할 수 있다.
    if (typeof window !== 'undefined') {
      const forced = window.localStorage.getItem('sj-force-lowperf')
      if (forced === '1') return true
      if (forced === '0') return false
    }
  } catch {
    /* localStorage 불가 시 UA 판정으로 폴백 */
  }
  return isElectron()
})()
