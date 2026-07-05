import type { AttendanceRecord } from '@shared/commercial/models'

/**
 * Attendance input validation + labels (renderer). Client-side validation is UX
 * support only — RLS + DB constraints are the real enforcement. Never logs values
 * (and never handles/logs raw photo image data).
 */

export type AttendanceType = AttendanceRecord['type']
export type AttendanceStatus = AttendanceRecord['status']

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['normal', 'late', 'early-leave', 'missing']
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  normal: '정상',
  late: '지각',
  'early-leave': '조퇴',
  missing: '누락'
}
export const ATTENDANCE_TYPE_LABEL: Record<AttendanceType, string> = {
  'check-in': '출근',
  'check-out': '퇴근'
}

export interface AttendanceInput {
  type: AttendanceType
  status: AttendanceStatus
  timestamp: string
  photoPath?: string
  watermarkText?: string
  memo?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** Validate an attendance payload. Never logs the values (esp. no photo data). */
export function validateAttendanceInput(input: AttendanceInput): ValidationResult {
  const errors: string[] = []
  if (input.type !== 'check-in' && input.type !== 'check-out') errors.push('출퇴근 유형이 올바르지 않습니다.')
  if (!ATTENDANCE_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
  if (!input.timestamp?.trim() || Number.isNaN(Date.parse(input.timestamp))) errors.push('기록 시간이 올바르지 않습니다.')
  if ((input.memo ?? '').length > 500) errors.push('메모는 500자 이내여야 합니다.')
  if ((input.watermarkText ?? '').length > 300) errors.push('워터마크 텍스트가 너무 깁니다.')
  if ((input.photoPath ?? '').length > 500) errors.push('사진 경로가 너무 깁니다.')
  return { ok: errors.length === 0, errors }
}
