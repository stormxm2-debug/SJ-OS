/**
 * 메뉴에 보이는 항목 목록 (단일 기준).
 * 화면(route)은 그대로 두고, 메뉴에서만 이 목록의 항목을 요청한 순서대로 보여 준다.
 * 직원 모드·대표 모드, 데스크톱·모바일 모두 같은 목록을 쓴다.
 * 나중에 항목을 더 보이게 하려면 여기 키만 추가하면 된다.
 */
export const VISIBLE_MENU_KEYS: string[] = [
  'staff-home', // 홈
  'attendance', // 출퇴근
  'schedule', // 오늘일정(일정)
  'customer', // 고객
  'family-caregiver', // 가족 간병인 접수
  'bojang114', // 한장보험료 비교
  'performance', // 실적(매출현황)
  'notice', // 공지사항
  'notification-settings', // 알림 설정 (알림 켜기·테스트·켜는 방법)
  'health-record', // 고객 건강기록 조회
  'jarvis' // 자비스 (내가 말하는 기능)
]

/**
 * 메뉴 어디에도(메뉴·전체 메뉴, 데스크톱·모바일) 보이지 않게 할 항목 (대표 지시).
 * 화면(route) 자체는 남겨 둔다 — 다시 보이게 하려면 여기서 키만 빼면 된다.
 */
export const REMOVED_MENU_KEYS: string[] = [
  'salary', // 급여 계산기
  'sales-activity', // 영업활동
  'stats-report' // 통계 리포트
]

/** 항목 목록에서 보이는 것만 골라 VISIBLE_MENU_KEYS 순서로 돌려준다. 같은 키는 첫 번째만. */
export function pickVisibleMenuItems<T extends { key: string }>(items: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const it of items) if (!byKey.has(it.key)) byKey.set(it.key, it)
  const out: T[] = []
  for (const k of VISIBLE_MENU_KEYS) {
    const hit = byKey.get(k)
    if (hit && !REMOVED_MENU_KEYS.includes(k)) out.push(hit)
  }
  return out
}

/** 표시 목록에 없는 나머지 항목(원래 순서 유지). '전체 메뉴' 칸에 넣는다. 같은 키는 첫 번째만. */
export function pickHiddenMenuItems<T extends { key: string }>(items: T[]): T[] {
  const shown = new Set(VISIBLE_MENU_KEYS)
  const seen = new Set<string>(REMOVED_MENU_KEYS)
  const out: T[] = []
  for (const it of items) {
    if (shown.has(it.key) || seen.has(it.key)) continue
    seen.add(it.key)
    out.push(it)
  }
  return out
}
