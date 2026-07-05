/**
 * Korean phone-number normalization (shared). Normalizes to E.164 (+8210XXXXXXXX).
 * Never logs raw phone numbers.
 */

export interface PhoneNormalizeResult {
  ok: boolean
  value?: string
  error?: string
}

const INVALID = '휴대폰 번호 형식을 확인해주세요.'

/**
 * Accepts 01012345678 / 010-1234-5678 / +821012345678 (spaces/hyphens ok) and
 * returns +8210XXXXXXXX. Returns { ok:false } with a generic error otherwise.
 */
export function normalizeKoreanPhoneNumber(input: string): PhoneNormalizeResult {
  const raw = (input ?? '').replace(/[\s-]/g, '')
  if (!raw) return { ok: false, error: INVALID }
  let n: string
  if (raw.startsWith('+82')) n = '+82' + raw.slice(3).replace(/^0/, '')
  else if (raw.startsWith('82')) n = '+82' + raw.slice(2).replace(/^0/, '')
  else if (raw.startsWith('010')) n = '+82' + raw.slice(1)
  else if (raw.startsWith('10') && (raw.length === 9 || raw.length === 10)) n = '+82' + raw
  else return { ok: false, error: INVALID }
  if (!/^\+8210\d{7,8}$/.test(n)) return { ok: false, error: INVALID }
  return { ok: true, value: n }
}

/** Mask a normalized phone for safe display (e.g. +8210****5678). Never full. */
export function maskPhone(normalized: string): string {
  if (!normalized || normalized.length < 8) return '****'
  return `${normalized.slice(0, 5)}****${normalized.slice(-4)}`
}
