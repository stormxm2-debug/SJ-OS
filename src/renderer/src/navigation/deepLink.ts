import type { View, ViewName } from './types'

/**
 * 홈 화면(PWA) 딥링크로 바로 열 수 있는 '인자 없는' 안전한 시작 화면들.
 *
 * 폰 홈 화면에 설치한 PWA 아이콘을 누르면 manifest 의 start_url(`/?view=schedule`)로
 * 열리는데, 그때 이 목록에 있는 화면만 시작 화면으로 허용한다. 모두 역할 공용 STAFF
 * 라우트이며 추가 인자가 필요 없다(workerId 등 필수 인자가 있는 화면은 제외 → 안전).
 */
export const DEEP_LINK_VIEWS: ViewName[] = ['staff-home', 'schedule', 'shared-schedule', 'attendance', 'customer']

/**
 * URL 쿼리에서 시작 화면을 고른다. `?view=schedule` 처럼 안전 목록에 있는 값이면 그 화면,
 * 없거나 알 수 없으면 홈(staff-home). 순수 함수 — 단위테스트 대상.
 */
export function parseInitialView(search: string): View {
  try {
    const v = new URLSearchParams(search).get('view')
    if (v && (DEEP_LINK_VIEWS as string[]).includes(v)) {
      return { name: v as ViewName } as View
    }
  } catch {
    /* 쿼리 파싱 불가 환경은 조용히 홈으로 */
  }
  return { name: 'staff-home' }
}
