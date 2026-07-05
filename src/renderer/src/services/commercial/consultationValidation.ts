import type { ConsultationRecord } from '@shared/commercial/models'

/**
 * Consultation input validation + labels (renderer). Client-side validation is UX
 * support only — RLS + DB constraints are the real enforcement. Never logs values.
 */

export type ConsultationType = ConsultationRecord['consultationType']
export type ConsultationStatus = ConsultationRecord['status']

export const CONSULTATION_TYPES: ConsultationType[] = ['first', 'follow-up', 'proposal', 'closing', 'aftercare']
export const CONSULTATION_TYPE_LABEL: Record<ConsultationType, string> = {
  first: '첫 상담',
  'follow-up': '후속 상담',
  proposal: '제안',
  closing: '클로징',
  aftercare: '사후관리'
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
  if (!CONSULTATION_TYPES.includes(input.consultationType)) errors.push('상담 유형이 올바르지 않습니다.')
  if (!CONSULTATION_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
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
