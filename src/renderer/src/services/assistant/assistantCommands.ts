import type { ViewName } from '@renderer/navigation/types'

/**
 * 경영 비서 로컬 인텐트 라우터 — 브레인(원격 AI)에 보내기 전에, 앱이 직접
 * "실행"으로 처리할 수 있는 명령을 감지한다.
 *
 * ① 일정 등록: "내일 2시 김민준 클로징 잡아줘" → parse-schedule로 해석 후 확인 카드
 * ② 공지 등록(관리자): "공지: 내용" → 확인 카드 후 공지사항에 발행
 * ③ 화면 이동 폴백: 서버(브레인) 미연결 환경에서 키워드로 화면 이동
 */

/** 일정 등록 의도 — 시간·만남 표현 + 등록성 동사가 함께 있을 때만. */
export function isScheduleIntent(text: string): boolean {
  const t = text.trim()
  const hasMeeting = /(일정|약속|미팅|만남|클로징|증권\s*전달|상담|AP|에이피)/i.test(t)
  const hasVerb = /(잡아|등록|추가|넣어|예약|만들)/.test(t)
  return hasMeeting && hasVerb
}

export interface AnnouncementDraft {
  title: string
  body: string
}

/** '공지:' / '공지사항:' 프리픽스 명령 → 제목·본문 초안. 아니면 null. */
export function parseAnnouncementIntent(text: string): AnnouncementDraft | null {
  const m = text.trim().match(/^공지(?:사항)?\s*[:：]\s*([\s\S]+)$/)
  if (!m) return null
  const content = m[1].trim()
  if (!content) return null
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  // 첫 줄이 짧으면 제목으로, 아니면 앞 20자를 제목으로 삼는다.
  if (lines.length > 1 && lines[0].length <= 40) {
    return { title: lines[0], body: lines.slice(1).join('\n') }
  }
  const title = content.length <= 40 ? content : `${content.slice(0, 20)}…`
  return { title, body: content }
}

/** 서버 미연결(데모/오프라인) 폴백 — 키워드로 화면 이동만 지원. */
const NAV_KEYWORDS: { keywords: string[]; view: ViewName; label: string }[] = [
  { keywords: ['오늘의 접촉', '접촉 리스트', '콜리스트', '콜 리스트'], view: 'today-contacts', label: '오늘의 접촉' },
  { keywords: ['소개 영업', '소개영업', '리퍼럴', '골든타임'], view: 'referrals', label: '소개 영업' },
  { keywords: ['생일'], view: 'birthdays', label: '생일 챙기기' },
  { keywords: ['고객'], view: 'customer', label: '고객 관리' },
  { keywords: ['일정', '스케줄'], view: 'schedule', label: '일정' },
  { keywords: ['실적', '매출'], view: 'performance', label: '실적' },
  { keywords: ['통계', '리포트'], view: 'stats-report', label: '통계 리포트' },
  { keywords: ['리드', 'DB 배정', 'db'], view: 'leads', label: 'DB 배정' },
  { keywords: ['청구'], view: 'claim-assistant', label: '보험금 청구비서' },
  { keywords: ['보장분석', '보험분석'], view: 'insurance-analysis', label: 'AI 보장분석' },
  { keywords: ['사전심사', '인수'], view: 'pre-underwriting', label: 'AI 사전심사' },
  { keywords: ['공지'], view: 'notice', label: '공지사항' },
  { keywords: ['출근', '출퇴근'], view: 'attendance', label: '출퇴근' },
  { keywords: ['자료실', '파일'], view: 'files', label: '자료실' }
]

export function localNavFallback(text: string): { view: ViewName; label: string } | null {
  const t = text.toLowerCase()
  for (const item of NAV_KEYWORDS) {
    if (item.keywords.some((k) => t.includes(k.toLowerCase()))) return { view: item.view, label: item.label }
  }
  return null
}
