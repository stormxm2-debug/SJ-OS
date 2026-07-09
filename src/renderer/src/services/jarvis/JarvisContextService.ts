import { listScheduleEvents } from '@renderer/services/commercial/scheduleService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { listMyTodayAttendance } from '@renderer/services/commercial/attendanceService'
import { currentMonth, listEntriesMonth, weightedTotal } from '@renderer/services/commercial/performanceRecordsService'

/**
 * 자비스 브레인용 사내 실시간 데이터 스냅샷.
 *
 * 브레인 호출 직전에 오늘 일정·이번 달 실적·고객 수·출근 상태를 가볍게 모아
 * 한국어 텍스트 블록으로 만든다 — 자비스가 "오늘 뭐 해야 해?" 같은 질문에
 * 실제 데이터로 답할 수 있게 하는 재료. RLS가 접근 경계이므로 본인 권한
 * 범위의 데이터만 조회된다. 실패한 항목은 조용히 생략 (스냅샷은 보조 정보).
 */

const TYPE_LABEL: Record<string, string> = {
  ap: 'AP',
  'meeting-1': '1차만남',
  'meeting-2': '2차만남',
  'meeting-3': '3차만남',
  closing: '클로징',
  delivery: '증권전달',
  'intro-meeting': '소개미팅',
  meeting: '미팅',
  personal: '개인일정',
  consultation: '상담',
  contract: '계약',
  'follow-up': '후속관리',
  internal: '내근'
}

/** 각 조회에 개별 시간 예산 — 스냅샷 때문에 대화가 느려지지 않게 한다. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return await Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))
  ])
}

function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

/** 오늘 일정 섹션 (최대 6건). */
async function scheduleSection(todayIso: string): Promise<string | null> {
  const res = await withTimeout(listScheduleEvents(), 3000)
  if (!res || !res.ok) return null
  const today = res.events
    .filter((e) => e.startsAt?.startsWith(todayIso) && e.status !== 'cancelled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  if (today.length === 0) return '오늘 일정: 없음'
  const lines = today.slice(0, 6).map((e) => {
    const time = e.startsAt.slice(11, 16) || '시간미정'
    const who = e.customerName ?? e.manualCustomerName ?? ''
    const label = TYPE_LABEL[e.type] ?? e.type
    return `- ${time} ${label}${who ? ` · ${who}` : ''}${e.title ? ` · ${e.title}` : ''}${e.location ? ` @ ${e.location}` : ''}`
  })
  const more = today.length > 6 ? `\n(외 ${today.length - 6}건)` : ''
  return `오늘 일정 ${today.length}건:\n${lines.join('\n')}${more}`
}

/** 이번 달 실적 섹션 (입력 기준 합계 + 환산 총매출). */
async function performanceSection(): Promise<string | null> {
  const res = await withTimeout(listEntriesMonth(currentMonth()), 3000)
  if (!res || !res.ok) return null
  const sums = { life: 0, nonLife: 0, shortTerm: 0 }
  for (const e of res.data) {
    if (e.category === 'life') sums.life += e.amount
    else if (e.category === 'non-life') sums.nonLife += e.amount
    else if (e.category === 'short-term') sums.shortTerm += e.amount
  }
  return `이번 달(${currentMonth()}) 실적 입력 합계: 생보 ${won(sums.life)} · 손보 ${won(sums.nonLife)} · 단기납 ${won(sums.shortTerm)} · 환산 총매출 ${won(weightedTotal(sums))} (단기납 60% 환산)`
}

/** 고객 수 섹션. */
async function customerSection(): Promise<string | null> {
  const res = await withTimeout(listCustomers(), 3000)
  if (!res || !res.ok) return null
  return `등록 고객: 총 ${res.customers.length}명`
}

/** 오늘 출근 섹션. */
async function attendanceSection(): Promise<string | null> {
  const res = await withTimeout(listMyTodayAttendance(), 3000)
  if (!res || !res.ok) return null
  if (res.records.length === 0) return '오늘 출근 보고: 아직 없음'
  const first = res.records[0] as { checkInAt?: string; createdAt?: string }
  const at = (first.checkInAt ?? first.createdAt ?? '').slice(11, 16)
  return `오늘 출근 보고: 완료${at ? ` (${at})` : ''}`
}

/**
 * 스냅샷 빌드 — 전체 4초 예산. 아무것도 조회되지 않으면 빈 문자열을 돌려
 * 브레인이 "데이터 미조회" 모드로 답하게 한다.
 */
export async function buildJarvisContext(): Promise<string> {
  try {
    const now = new Date()
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const sections = await withTimeout(
      Promise.all([scheduleSection(todayIso), performanceSection(), customerSection(), attendanceSection()]),
      4000
    )
    if (!sections) return ''
    const body = sections.filter((s): s is string => Boolean(s)).join('\n')
    if (!body) return ''
    const stamp = `${todayIso} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    return `[사내 데이터 스냅샷 · ${stamp} 조회]\n${body}`.slice(0, 4000)
  } catch {
    return ''
  }
}
