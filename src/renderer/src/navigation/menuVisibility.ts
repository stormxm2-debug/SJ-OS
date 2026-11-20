/**
 * 메뉴에 보이는 항목 목록 (단일 기준).
 * 화면(route)은 그대로 두고, 메뉴에서만 이 목록의 항목을 요청한 순서대로 보여 준다.
 * 직원 모드·대표 모드, 데스크톱·모바일 모두 같은 목록을 쓴다.
 * 나중에 항목을 더 보이게 하려면 여기 키만 추가하면 된다.
 */
export const VISIBLE_MENU_KEYS: string[] = [
  'backoffice-desk', // 고객등록 현황(총무 상황판) — 역할별 접근은 canAccessRoute 가 거른다
  'staff-home', // 홈
  'attendance', // 출퇴근
  'schedule', // 오늘일정(일정)
  'customer', // 고객
  'family-caregiver', // 가족 간병인 접수
  'bojang114', // 한장보험료 비교
  'performance', // 실적(매출현황)
  'notice', // 공지사항
  'health-record', // 고객 건강기록 조회
  'jarvis' // 자비스 (내가 말하는 기능)
]

/** 항목 목록에서 보이는 것만 골라 VISIBLE_MENU_KEYS 순서로 돌려준다. 같은 키는 첫 번째만. */
export function pickVisibleMenuItems<T extends { key: string }>(items: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const it of items) if (!byKey.has(it.key)) byKey.set(it.key, it)
  const out: T[] = []
  for (const k of VISIBLE_MENU_KEYS) {
    const hit = byKey.get(k)
    if (hit) out.push(hit)
  }
  return out
}

/** 표시 목록에 없는 나머지 항목(원래 순서 유지). '전체 메뉴' 칸에 넣는다. 같은 키는 첫 번째만. */
export function pickHiddenMenuItems<T extends { key: string }>(items: T[]): T[] {
  const shown = new Set(VISIBLE_MENU_KEYS)
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    if (shown.has(it.key) || seen.has(it.key)) continue
    seen.add(it.key)
    out.push(it)
  }
  return out
}
