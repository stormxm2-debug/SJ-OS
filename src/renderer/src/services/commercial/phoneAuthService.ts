import { normalizeKoreanPhoneNumber } from '@shared/phone'
import { findByNormalizedPhone, requestPasswordReset } from './phoneLoginStore'
import { getEdgeFunctionBase } from './supabaseAuth'

/**
 * Phone/password login resolution + first-password / reset boundaries (renderer).
 *
 * SECURITY: never uses/sends the service_role key. Creating auth users + setting
 * passwords requires admin privileges and MUST run in a server-side Edge Function —
 * this module only calls a configured endpoint (or reports "server function
 * required"). Never logs phone numbers, passwords, tokens, or sessions.
 */

export type LoginResolution =
  | { kind: 'invalid-phone'; message: string }
  | { kind: 'not-registered'; message: string }
  | { kind: 'inactive'; message: string }
  | { kind: 'needs-password-setup'; normalizedPhone: string }
  | { kind: 'attempt'; normalizedPhone: string }

const GATE_MSG = '등록된 직원만 이용할 수 있습니다. 관리자에게 계정 등록을 요청하세요.'
const INACTIVE_MSG = '비활성 직원 계정입니다. 관리자에게 문의하세요.'

/** Resolve what the login screen should do next for a given phone input. */
export function resolvePhoneLogin(phoneInput: string): LoginResolution {
  const norm = normalizeKoreanPhoneNumber(phoneInput)
  if (!norm.ok || !norm.value) return { kind: 'invalid-phone', message: norm.error ?? '휴대폰 번호 형식을 확인해주세요.' }
  const acc = findByNormalizedPhone(norm.value)
  if (!acc) return { kind: 'not-registered', message: GATE_MSG }
  if (acc.status === 'inactive' || acc.status === 'blocked') return { kind: 'inactive', message: INACTIVE_MSG }
  if (acc.passwordStatus === 'not-set' || acc.passwordStatus === 'reset-approved') {
    return { kind: 'needs-password-setup', normalizedPhone: norm.value }
  }
  return { kind: 'attempt', normalizedPhone: norm.value }
}

export interface PasswordValidation {
  ok: boolean
  errors: string[]
}
/** Password policy: 8–72 chars, at least one letter + one number. */
export function validatePassword(pw: string, confirm?: string): PasswordValidation {
  const errors: string[] = []
  if (pw.length < 8) errors.push('비밀번호는 8자 이상이어야 합니다.')
  if (pw.length > 72) errors.push('비밀번호는 72자 이하여야 합니다.')
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.push('비밀번호에는 영문과 숫자를 포함해야 합니다.')
  if (confirm !== undefined && pw !== confirm) errors.push('비밀번호 확인이 일치하지 않습니다.')
  return { ok: errors.length === 0, errors }
}

export interface ServerActionResult {
  ok: boolean
  message: string
}

const SERVER_REQUIRED = '최초 비밀번호 설정 서버 함수가 아직 연결되지 않았습니다. 관리자에게 문의하세요.'

/**
 * Claim an account = set the first password. DEFERRED to a server Edge Function.
 * Never sends service_role. When no endpoint is configured, returns a clear
 * "server function required" result (does NOT fake success).
 */
export async function claimPhoneAccount(normalizedPhone: string, password: string): Promise<ServerActionResult> {
  const base = getEdgeFunctionBase()
  if (!base) return { ok: false, message: SERVER_REQUIRED }
  const v = validatePassword(password)
  if (!v.ok) return { ok: false, message: v.errors[0] }
  try {
    const res = await fetch(`${base}/claim-phone-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedPhone, password }) // anon call; server verifies + uses service_role server-side
    })
    if (!res.ok) return { ok: false, message: '비밀번호 설정에 실패했습니다. 관리자에게 문의하세요.' }
    return { ok: true, message: '비밀번호가 설정되었습니다. 이제 로그인할 수 있습니다.' }
  } catch {
    return { ok: false, message: '네트워크 상태를 확인해주세요.' }
  }
}

/** Forgot password → record a reset request; always returns a GENERIC message. */
export function requestPhonePasswordReset(phoneInput: string): ServerActionResult {
  const norm = normalizeKoreanPhoneNumber(phoneInput)
  if (norm.ok && norm.value) requestPasswordReset(norm.value)
  return { ok: true, message: '등록된 직원이면 관리자에게 비밀번호 재설정 요청이 전달됩니다.' }
}
