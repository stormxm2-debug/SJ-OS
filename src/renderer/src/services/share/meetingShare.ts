import type { ScheduleWithCustomer } from '@renderer/services/commercial/supabaseScheduleAdapter'

/**
 * 미팅 일정 → 카톡 공유 (무료 · 즉시 사용).
 *
 * - 폰: OS 공유창(navigator.share) → 카톡 방 선택해 바로 전송.
 * - 공유창이 없는 환경(데스크톱 브라우저, 일부 인앱브라우저): 클립보드 복사 폴백.
 * - 알림톡(자동 발송)과 별개로, 단톡방 공유·수동 전달용으로 계속 유지한다.
 */

const TYPE_LABEL: Record<string, string> = {
  ap: 'AP',
  'meeting-1': '1차만남',
  'meeting-2': '2차만남',
  'meeting-3': '3차만남',
  closing: '클로징',
  delivery: '증권 전달',
  'intro-meeting': '소개만남',
  meeting: '만남',
  personal: '개인 일정',
  consultation: '상담',
  contract: '계약',
  'follow-up': '팔로업',
  internal: '내부 일정'
}

/** "7월 15일(화) 오후 2:00" 형태 (KST). */
export function formatMeetingDateTime(iso: string): string {
  const d = new Date(Date.parse(iso))
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${date} ${time}`
}

/** 고객에게 보내도 되는 정중한 미팅 안내 문안. */
export function buildMeetingMessage(event: ScheduleWithCustomer, staffName?: string): string {
  const lines: string[] = ['[SJ INVEST] 미팅 안내', '']
  if (event.customerName) {
    lines.push(`안녕하세요 ${event.customerName}님, SJ INVEST${staffName ? ` ${staffName}` : ''}입니다.`, '')
  }
  lines.push(`■ 일시: ${formatMeetingDateTime(event.startsAt)}`)
  if (event.location) lines.push(`■ 장소: ${event.location}`)
  lines.push(`■ 내용: ${TYPE_LABEL[event.type] ?? '미팅'}`)
  lines.push('', '일정 변경이 필요하시면 편하게 연락 주세요. 감사합니다.')
  return lines.join('\n')
}

export type ShareOutcome = 'shared' | 'copied' | 'failed'

/** OS 공유창 → 실패/미지원 시 클립보드 복사. */
export async function shareMeetingText(text: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (e) {
      // 사용자가 공유창을 닫은 경우(AbortError)는 조용히 종료 — 복사로 대체하지 않는다.
      if (e instanceof DOMException && e.name === 'AbortError') return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
