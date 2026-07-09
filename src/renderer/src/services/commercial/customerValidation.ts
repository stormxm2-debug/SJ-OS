import type { CustomerAttachment, CustomerStatus } from '@shared/commercial/models'

/**
 * Customer input validation + labels (renderer). Client-side validation is
 * UX support only — RLS + DB constraints are the real enforcement.
 *
 * v2 (2026-07): 생년월일·태그·상태 입력 제거(상태 컬럼은 내부 기본값 유지),
 * 주민번호(나이·성별 자동 계산)·병력·키/몸무게·가족(household)·첨부 추가.
 * 유입경로는 4종 칩: 지인/돌방/소개/DB.
 */

export const CUSTOMER_STATUSES: CustomerStatus[] = [
  'new',
  'contacted',
  'consulting',
  'proposal',
  'closing',
  'contracted',
  'lost'
]

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  new: '신규',
  contacted: '연락완료',
  consulting: '상담중',
  proposal: '제안',
  closing: '클로징',
  contracted: '계약완료',
  lost: '실패/보류'
}

/** 유입경로 선택지 (저장값 = 라벨 그대로). */
export const CUSTOMER_SOURCES = ['지인', '돌방', '소개', 'DB'] as const

/** 가족 관계 선택지 (세대주 = 본인). */
export const RELATION_OPTIONS = ['배우자', '자녀', '부모', '형제자매', '기타'] as const

export interface CustomerInput {
  name: string
  phone?: string
  birthDate?: string
  address?: string
  source?: string
  status: CustomerStatus
  tags: string[]
  memo?: string
  rrn?: string
  medicalHistory?: string
  heightCm?: number
  weightKg?: number
  householdId?: string
  relation?: string
  attachments?: CustomerAttachment[]
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** 주민번호 형식 정리: 숫자만 남기고 6-7이면 하이픈 형식으로. */
export function normalizeRrn(input: string): string {
  const digits = input.replace(/[^0-9]/g, '')
  if (digits.length !== 13) return input.trim()
  return `${digits.slice(0, 6)}-${digits.slice(6)}`
}

export interface RrnInfo {
  birthDate: string // YYYY-MM-DD
  age: number // 만 나이
  gender: '남' | '여'
}

/**
 * 주민번호 → 생년월일·만나이·성별. 형식이 안 맞으면 null.
 * 7번째 자리: 1·2=1900년대, 3·4=2000년대, 5·6=1900년대 외국인, 7·8=2000년대 외국인, 9·0=1800년대.
 */
export function parseRrn(rrn?: string): RrnInfo | null {
  if (!rrn) return null
  const digits = rrn.replace(/[^0-9]/g, '')
  if (digits.length < 7) return null
  const yy = Number(digits.slice(0, 2))
  const mm = Number(digits.slice(2, 4))
  const dd = Number(digits.slice(4, 6))
  const s = Number(digits[6])
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const century = s === 9 || s === 0 ? 1800 : s === 1 || s === 2 || s === 5 || s === 6 ? 1900 : 2000
  const year = century + yy
  const birth = new Date(year, mm - 1, dd)
  if (birth.getMonth() !== mm - 1 || birth.getDate() !== dd) return null
  const now = new Date()
  let age = now.getFullYear() - year
  if (now.getMonth() + 1 < mm || (now.getMonth() + 1 === mm && now.getDate() < dd)) age -= 1
  if (age < 0 || age > 130) return null
  const gender: '남' | '여' = s % 2 === 1 ? '남' : '여'
  const p = (n: number): string => String(n).padStart(2, '0')
  return { birthDate: `${year}-${p(mm)}-${p(dd)}`, age, gender }
}

/** BMI (소수 1자리) — 키·몸무게 있으면. */
export function bmiOf(heightCm?: number, weightKg?: number): number | null {
  if (!heightCm || !weightKg || heightCm < 80 || heightCm > 250 || weightKg < 20 || weightKg > 300) return null
  const m = heightCm / 100
  return Math.round((weightKg / (m * m)) * 10) / 10
}

/** Validate a customer create/update payload. Never logs the values. */
export function validateCustomerInput(input: CustomerInput): ValidationResult {
  const errors: string[] = []
  const name = input.name?.trim() ?? ''
  if (!name) errors.push('고객명을 입력해주세요.')
  if (name.length > 50) errors.push('고객명은 50자 이내여야 합니다.')
  if ((input.phone ?? '').length > 30) errors.push('연락처는 30자 이내여야 합니다.')
  if ((input.address ?? '').length > 200) errors.push('주소는 200자 이내여야 합니다.')
  if ((input.memo ?? '').length > 1000) errors.push('메모는 1000자 이내여야 합니다.')
  if ((input.medicalHistory ?? '').length > 2000) errors.push('병력은 2000자 이내여야 합니다.')
  if (input.rrn && input.rrn.trim()) {
    const digits = input.rrn.replace(/[^0-9]/g, '')
    if (digits.length !== 13 || !parseRrn(input.rrn)) errors.push('주민등록번호 13자리를 확인해주세요.')
  }
  if (input.heightCm !== undefined && input.heightCm !== null && input.heightCm !== 0) {
    if (input.heightCm < 80 || input.heightCm > 250) errors.push('키는 80~250cm 범위로 입력해주세요.')
  }
  if (input.weightKg !== undefined && input.weightKg !== null && input.weightKg !== 0) {
    if (input.weightKg < 20 || input.weightKg > 300) errors.push('몸무게는 20~300kg 범위로 입력해주세요.')
  }
  if ((input.attachments ?? []).length > 5) errors.push('첨부는 고객당 최대 5개입니다.')
  if (!CUSTOMER_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
  return { ok: errors.length === 0, errors }
}
