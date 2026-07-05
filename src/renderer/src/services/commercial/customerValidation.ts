import type { CustomerStatus } from '@shared/commercial/models'

/**
 * Customer input validation + status labels (renderer). Client-side validation is
 * UX support only — RLS + DB constraints are the real enforcement.
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

export interface CustomerInput {
  name: string
  phone?: string
  birthDate?: string
  address?: string
  source?: string
  status: CustomerStatus
  tags: string[]
  memo?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** Validate a customer create/update payload. Never logs the values. */
export function validateCustomerInput(input: CustomerInput): ValidationResult {
  const errors: string[] = []
  const name = input.name?.trim() ?? ''
  if (!name) errors.push('고객명을 입력해주세요.')
  if (name.length > 50) errors.push('고객명은 50자 이내여야 합니다.')
  if ((input.phone ?? '').length > 30) errors.push('연락처는 30자 이내여야 합니다.')
  if ((input.address ?? '').length > 200) errors.push('주소는 200자 이내여야 합니다.')
  if ((input.source ?? '').length > 50) errors.push('유입경로는 50자 이내여야 합니다.')
  if ((input.memo ?? '').length > 1000) errors.push('메모는 1000자 이내여야 합니다.')
  if (input.tags.length > 10) errors.push('태그는 최대 10개까지 가능합니다.')
  if (input.tags.some((t) => t.length > 20)) errors.push('각 태그는 20자 이내여야 합니다.')
  if (!CUSTOMER_STATUSES.includes(input.status)) errors.push('상태 값이 올바르지 않습니다.')
  if (input.birthDate && input.birthDate.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate.trim())) errors.push('생년월일은 YYYY-MM-DD 형식이어야 합니다.')
  }
  return { ok: errors.length === 0, errors }
}
