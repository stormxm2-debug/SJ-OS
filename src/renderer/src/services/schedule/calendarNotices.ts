/**
 * 캘린더에 올라가는 회사 공지 판정·정렬 (순수 함수, 한국시간 기준).
 *
 * 규칙(지시서 3절):
 * - 날짜가 없는 공지는 월간 달력에 올리지 않는다.
 * - 단일 날짜(startDate만) 또는 기간(startDate~endDate)을 해당 날짜 칸에 표시한다.
 * - 같은 날 여러 공지는 중요도(긴급>중요>일반) → 고정 → 최근 등록 순으로 정렬한다.
 * - 제목이 길면 말줄임 처리(표시는 컴포넌트, 여기서는 길이 제한 값만 계산).
 */

export type NoticePriority = 'normal' | 'important' | 'urgent'

export interface CalendarNotice {
  id: string
  title: string
  priority: NoticePriority
  pinned: boolean
  /** 'YYYY-MM-DD' (한국시간 날짜). 없으면 달력에 올리지 않음. */
  startDate?: string
  /** 'YYYY-MM-DD'. 없으면 startDate 하루짜리. */
  endDate?: string
  /** 등록/게시 시각(정렬 보조). */
  publishedAt?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PRIORITY_RANK: Record<NoticePriority, number> = { urgent: 0, important: 1, normal: 2 }

function isDateKey(s?: string): s is string {
  return !!s && DATE_RE.test(s)
}

/** 공지가 특정 날짜('YYYY-MM-DD')에 표시되는가. 날짜 없는 공지는 항상 false. */
export function noticeCoversDay(n: CalendarNotice, dayKey: string): boolean {
  if (!isDateKey(n.startDate)) return false
  const start = n.startDate
  const end = isDateKey(n.endDate) && n.endDate >= start ? n.endDate : start
  // 'YYYY-MM-DD' 문자열 비교는 사전순 = 날짜순 (형식 고정 시 안전).
  return dayKey >= start && dayKey <= end
}

/** 같은 날 공지 정렬: 중요도 → 고정 → 최근 게시. */
export function sortNoticesForDay(list: CalendarNotice[]): CalendarNotice[] {
  return [...list].sort((a, b) => {
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const at = Date.parse(a.publishedAt ?? '') || 0
    const bt = Date.parse(b.publishedAt ?? '') || 0
    return bt - at
  })
}

/**
 * 날짜 키 → 그 날 표시할 공지 목록(정렬 완료). 날짜 없는 공지는 제외.
 * dayKeys 는 월 그리드에 실제 보이는 날짜만 넘기면 된다(성능).
 */
export function noticesByDayKey(notices: CalendarNotice[], dayKeys: string[]): Map<string, CalendarNotice[]> {
  const out = new Map<string, CalendarNotice[]>()
  for (const key of dayKeys) {
    const hits = notices.filter((n) => noticeCoversDay(n, key))
    if (hits.length) out.set(key, sortNoticesForDay(hits))
  }
  return out
}

/** 제목 말줄임 — 칸 표시용 길이 제한(전체 내용은 title 속성/상세에서 확인). */
export function truncateTitle(title: string, max = 14): string {
  const t = (title ?? '').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
