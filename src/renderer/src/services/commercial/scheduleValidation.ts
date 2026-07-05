import type { ScheduleEvent } from '@shared/commercial/models'

/**
 * Schedule input validation + labels (renderer). Client-side validation is UX
 * support only — RLS + DB constraints are the real enforcement. Never logs values.
 */

export type ScheduleType = ScheduleEvent['type']
export type ScheduleStatus = ScheduleEvent['status']

export const SCHEDULE_TYPES: ScheduleType[] = ['consultation', 'contract', 'follow-up', 'internal', 'personal']
export const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = {
  consultation: '상담',
  contract: '계약',
  'follow-up': '후속관리',
  internal: '내부일정',
  personal: '개인일정'
}
/** Types that generally involve a linked customer. */
export const CUSTOMER_LINKED_TYPES: ScheduleType[] = ['consultation', 'contract', 'follow-up']

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
  startsAt: string
  endsAt?: string
  memo?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function parse(v?: string): number {
  return v ? Date.parse(v) : NaN
}

/** Validate a schedule create/update payload. Never logs the values. */
export function validateScheduleInput(input: ScheduleInput): ValidationResult {
  const errors: string[] = []
  if (!input.title?.trim()) errors.push('일정명을 입력해주세요.')
  if ((input.title ?? '').length > 100) errors.push('일정명은 100자 이내여야 합니다.')
  if (!SCHEDULE_TYPES.includes(input.type)) errors.push('일정 유형이 올바르지 않습니다.')
  if (!SCHEDULE_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
  if ((input.memo ?? '').length > 1000) errors.push('메모는 1000자 이내여야 합니다.')
  const start = parse(input.startsAt)
  if (!input.startsAt?.trim() || Number.isNaN(start)) errors.push('시작시간을 올바르게 입력해주세요.')
  if (input.endsAt && input.endsAt.trim()) {
    const end = parse(input.endsAt)
    if (Number.isNaN(end)) errors.push('종료시간 형식이 올바르지 않습니다.')
    else if (!Number.isNaN(start) && end < start) errors.push('종료시간은 시작시간 이후여야 합니다.')
  }
  return { ok: errors.length === 0, errors }
}
