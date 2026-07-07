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
  /** Storage object path/key for the photo (short). Used once Supabase Storage is wired. */
  photoPath?: string
  /**
   * Inline watermarked photo as a `data:image/*;base64,...` URL. Held for local-mock
   * display only (never uploaded to a DB path column). Large by nature, so it is size-
   * capped rather than length-capped like a path.
   */
  photoDataUrl?: string
  watermarkText?: string
  memo?: string
}

/** ~8MB cap on the inline photo data URL to bound renderer memory. */
const MAX_PHOTO_DATA_URL_CHARS = 8_000_000

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
  if (input.photoDataUrl && !input.photoDataUrl.startsWith('data:image/')) errors.push('사진 형식이 올바르지 않습니다.')
  if ((input.photoDataUrl ?? '').length > MAX_PHOTO_DATA_URL_CHARS) errors.push('사진 용량이 너무 큽니다.')
  return { ok: errors.length === 0, errors }
}
