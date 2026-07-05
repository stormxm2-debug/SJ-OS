import { normalizeKoreanPhoneNumber } from '@shared/phone'
import { findByNormalizedPhone, requestPasswordReset } from './phoneLoginStore'
import { getFunctionsBaseUrl, getSupabaseAnonKey } from './supabaseClient'

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

const SERVER_REQUIRED = '최초 비밀번호 설정 서버 함수가 아직 배포되지 않았습니다. 관리자에게 문의하세요.'
const RESET_GENERIC = '등록된 직원이면 관리자에게 비밀번호 재설정 요청이 전달됩니다.'

/** Whether the Edge Function base URL is known (deploy readiness UI). */
export function isClaimFunctionConfigured(): boolean {
  return !!getFunctionsBaseUrl()
}

function functionHeaders(): Record<string, string> {
  const anon = getSupabaseAnonKey() // public anon key only — never service_role
  return { 'Content-Type': 'application/json', ...(anon ? { Authorization: `Bearer ${anon}`, apikey: anon } : {}) }
}

/**
 * Claim an account = set the first password via the server Edge Function
 * (claim-phone-account). Never sends service_role. When no endpoint is configured,
 * returns a clear "server function not deployed" result (does NOT fake success).
 * Never logs phone/password.
 */
export async function claimPhoneAccount(normalizedPhone: string, password: string): Promise<ServerActionResult> {
  const base = getFunctionsBaseUrl()
  if (!base) return { ok: false, message: SERVER_REQUIRED }
  const v = validatePassword(password)
  if (!v.ok) return { ok: false, message: v.errors[0] }
  try {
    const res = await fetch(`${base}/claim-phone-account`, {
      method: 'POST',
      headers: functionHeaders(),
      body: JSON.stringify({ phone: normalizedPhone, password })
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    if (res.ok && data?.ok) return { ok: true, message: data.message ?? '비밀번호 설정이 완료되었습니다. 이제 로그인해주세요.' }
    return { ok: false, message: data?.message ?? '비밀번호 설정에 실패했습니다. 관리자에게 문의하세요.' }
  } catch {
    return { ok: false, message: '네트워크 상태를 확인해주세요.' }
  }
}

/**
 * Forgot password → record a local draft request + best-effort server call. Always
 * returns a GENERIC message (no account enumeration). Never logs the phone.
 */
export function requestPhonePasswordReset(phoneInput: string): ServerActionResult {
  const norm = normalizeKoreanPhoneNumber(phoneInput)
  if (norm.ok && norm.value) {
    requestPasswordReset(norm.value) // local/draft record for admin visibility
    const base = getFunctionsBaseUrl()
    if (base) {
      // Fire-and-forget; errors are swallowed so nothing is revealed to the user.
      void fetch(`${base}/request-phone-password-reset`, {
        method: 'POST',
        headers: functionHeaders(),
        body: JSON.stringify({ phone: norm.value })
      }).catch(() => {})
    }
  }
  return { ok: true, message: RESET_GENERIC }
}
