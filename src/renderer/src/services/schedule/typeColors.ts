/**
 * 일정 유형별 색상 (순수 함수). 달력 칸 블록과 주간 시간표에서 같은 색을 쓴다.
 *
 * 색은 명시 hex 로 둔다 — 앱 Tailwind 의 slate 는 밝기 반전되어 있어 토큰에 기대면 색이 어긋난다.
 * 만남 계열(1·2·3차, 만남, 소개만남)은 같은 파랑 계열로 묶어 한눈에 구분되게 했다.
 */

export interface TypeStyle {
  /** 배경 */
  bg: string
  /** 테두리 */
  border: string
  /** 글자 */
  text: string
  /** 짧은 구분 라벨 */
  tag: string
}

const MEETING: TypeStyle = { bg: '#dbeafe', border: '#60a5fa', text: '#1e3a8a', tag: '만남' }
const CLOSING: TypeStyle = { bg: '#fef3c7', border: '#f59e0b', text: '#78350f', tag: '클로징' }
const AP: TypeStyle = { bg: '#ede9fe', border: '#a78bfa', text: '#4c1d95', tag: 'AP' }
const DELIVERY: TypeStyle = { bg: '#d1fae5', border: '#34d399', text: '#065f46', tag: '증전' }
const PERSONAL: TypeStyle = { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155', tag: '개인' }
const OTHER: TypeStyle = { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', tag: '일정' }

const STYLE_BY_TYPE: Record<string, TypeStyle> = {
  meeting: MEETING,
  'meeting-1': MEETING,
  'meeting-2': MEETING,
  'meeting-3': MEETING,
  'intro-meeting': MEETING,
  closing: CLOSING,
  ap: AP,
  delivery: DELIVERY,
  personal: PERSONAL
}

/** 유형 → 색. 알 수 없는 유형(구버전 포함)은 중립색. */
export function typeStyle(type?: string): TypeStyle {
  if (!type) return OTHER
  return STYLE_BY_TYPE[type] ?? OTHER
}
