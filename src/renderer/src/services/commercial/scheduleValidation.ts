import type { ScheduleEvent } from '@shared/commercial/models'

/**
 * Schedule input validation + labels (renderer). Client-side validation is UX
 * support only — RLS + DB constraints are the real enforcement. Never logs values.
 *
 * 개편(2026-07): 일정명 입력 없음(유형+고객으로 자동 생성), 유형은 영업 프로세스
 * 9종, 종료시간은 미팅 메모 저장 시 자동 기록.
 */

export type ScheduleType = ScheduleEvent['type']
export type ScheduleStatus = ScheduleEvent['status']

/** 신규 등록에서 선택 가능한 유형 9종 (표시 순서 그대로). */
export const SCHEDULE_TYPES: ScheduleType[] = [
  'ap',
  'meeting-1',
  'meeting-2',
  'meeting-3',
  'closing',
  'delivery',
  'intro-meeting',
  'meeting',
  'personal'
]

/** 전체 라벨(구버전 유형 포함 — 기존 행 표시용). */
export const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = {
  ap: 'AP',
  'meeting-1': '1차만남',
  'meeting-2': '2차만남',
  'meeting-3': '3차만남',
  closing: '클로징',
  delivery: '증전',
  'intro-meeting': '소개만남',
  meeting: '만남',
  personal: '개인일정',
  consultation: '상담(구)',
  contract: '계약(구)',
  'follow-up': '후속관리(구)',
  internal: '내부일정(구)'
}

/** 고객 연결이 자연스러운 유형(개인일정 제외 전부). UI 안내용. */
export const CUSTOMER_LINKED_TYPES: ScheduleType[] = [
  'ap',
  'meeting-1',
  'meeting-2',
  'meeting-3',
  'closing',
  'delivery',
  'intro-meeting',
  'meeting'
]

export const SCHEDULE_STATUSES: ScheduleStatus[] = ['planned', 'done', 'cancelled']
export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  planned: '예정',
  done: '완료',
  cancelled: '취소'
}

export interface ScheduleInput {
  title: string
  type: ScheduleType
  status: ScheduleStatus
  customerId?: string
  /** 고객관리에 없는 고객 이름(직접 입력). customerId와 동시 사용 안 함. */
  manualCustomerName?: string
  startsAt: string
  endsAt?: string
  memo?: string
  /** 만남 장소/주소 (선택). */
  location?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function parse(v?: string): number {
  return v ? Date.parse(v) : NaN
}

/** 유형+고객명으로 표시용 일정명 자동 생성 (title 입력칸 제거 대체). */
export function buildScheduleTitle(type: ScheduleType, customerName?: string): string {
  const label = SCHEDULE_TYPE_LABEL[type] ?? String(type)
  return customerName?.trim() ? `${label} · ${customerName.trim()}` : label
}

/** Validate a schedule create/update payload. Never logs the values. */
export function validateScheduleInput(input: ScheduleInput): ValidationResult {
  const errors: string[] = []
  // title은 자동 생성 — 비어 있어도 허용, 길이만 제한.
  if ((input.title ?? '').length > 100) errors.push('일정명은 100자 이내여야 합니다.')
  if (!SCHEDULE_TYPES.includes(input.type) && !['consultation', 'contract', 'follow-up', 'internal'].includes(input.type)) {
    errors.push('일정 유형이 올바르지 않습니다.')
  }
  if (!SCHEDULE_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
  if ((input.memo ?? '').length > 4000) errors.push('메모는 4000자 이내여야 합니다.')
  const start = parse(input.startsAt)
  if (!input.startsAt?.trim() || Number.isNaN(start)) errors.push('시작시간을 올바르게 선택해주세요.')
  if (input.endsAt && input.endsAt.trim()) {
    const end = parse(input.endsAt)
    if (Number.isNaN(end)) errors.push('종료시간 형식이 올바르지 않습니다.')
    else if (!Number.isNaN(start) && end < start) errors.push('종료시간은 시작시간 이후여야 합니다.')
  }
  return { ok: errors.length === 0, errors }
}
