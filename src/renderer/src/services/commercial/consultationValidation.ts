import type { ConsultationRecord } from '@shared/commercial/models'

/**
 * Consultation input validation + labels (renderer). Client-side validation is UX
 * support only — RLS + DB constraints are the real enforcement. Never logs values.
 */

export type ConsultationType = ConsultationRecord['consultationType']
export type ConsultationStatus = ConsultationRecord['status']
export type ConsultationChannel = NonNullable<ConsultationRecord['channel']>

/** 상담 v2 (대표 승인): 일정의 영업 퍼널과 통일된 8종 — 새 기록은 이 중에서만 선택. */
export const CONSULTATION_TYPES: ConsultationType[] = [
  'ap',
  'meeting-1',
  'meeting-2',
  'meeting-3',
  'closing',
  'delivery',
  'aftercare',
  'referral'
]

export const CONSULTATION_TYPE_LABEL: Record<ConsultationType, string> = {
  ap: 'AP',
  'meeting-1': '1차',
  'meeting-2': '2차',
  'meeting-3': '3차',
  closing: '클로징',
  delivery: '증권전달',
  aftercare: '사후관리',
  referral: '소개확보',
  // 구버전 값 (기존 행 표시용)
  first: '1차',
  'follow-up': '2차',
  proposal: '3차'
}

/** 구버전 유형 → 퍼널 유형 (필터·통계 집계용). */
export function normalizeConsultationType(t: ConsultationType): ConsultationType {
  if (t === 'first') return 'meeting-1'
  if (t === 'follow-up') return 'meeting-2'
  if (t === 'proposal') return 'meeting-3'
  return t
}

export const CONSULTATION_CHANNELS: ConsultationChannel[] = ['face', 'phone', 'message']
export const CONSULTATION_CHANNEL_LABEL: Record<ConsultationChannel, string> = {
  face: '대면',
  phone: '전화',
  message: '카톡·문자'
}

export const CONSULTATION_STATUSES: ConsultationStatus[] = ['planned', 'completed', 'cancelled']
export const CONSULTATION_STATUS_LABEL: Record<ConsultationStatus, string> = {
  planned: '예정',
  completed: '완료',
  cancelled: '취소'
}

export interface ConsultationInput {
  customerId: string
  consultationType: ConsultationType
  status: ConsultationStatus
  channel?: ConsultationChannel
  summary?: string
  nextAction?: string
  scheduledAt?: string
  completedAt?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function isValidDateTime(v: string): boolean {
  const t = Date.parse(v)
  return !Number.isNaN(t)
}

/** Validate a consultation create/update payload. Never logs the values. */
export function validateConsultationInput(input: ConsultationInput): ValidationResult {
  const errors: string[] = []
  if (!input.customerId?.trim()) errors.push('고객을 선택해주세요.')
  // 구버전 유형도 수정 저장 시 유효 (DB 체크 제약과 동일하게 허용)
  const legacyOk = ['first', 'follow-up', 'proposal'].includes(input.consultationType)
  if (!CONSULTATION_TYPES.includes(input.consultationType) && !legacyOk) errors.push('상담 유형이 올바르지 않습니다.')
  if (!CONSULTATION_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
  if (input.channel && !CONSULTATION_CHANNELS.includes(input.channel)) errors.push('접촉 방식이 올바르지 않습니다.')
  if ((input.summary ?? '').length > 2000) errors.push('상담 요약은 2000자 이내여야 합니다.')
  if ((input.nextAction ?? '').length > 500) errors.push('다음 액션은 500자 이내여야 합니다.')
  if (input.scheduledAt && input.scheduledAt.trim() && !isValidDateTime(input.scheduledAt)) errors.push('상담 예정일 형식이 올바르지 않습니다.')
  if (input.completedAt && input.completedAt.trim() && !isValidDateTime(input.completedAt)) errors.push('완료일 형식이 올바르지 않습니다.')
  return { ok: errors.length === 0, errors }
}

/** Normalize completedAt against status (completed→now if empty; else keep). */
export function normalizeCompletion(input: ConsultationInput): ConsultationInput {
  if (input.status === 'completed' && !input.completedAt?.trim()) {
    return { ...input, completedAt: new Date().toISOString() }
  }
  return input
}
