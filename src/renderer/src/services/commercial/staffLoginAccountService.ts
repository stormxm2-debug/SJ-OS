import type { PasswordResetRequest, StaffLoginAccount, StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { StaffRole } from '@shared/commercial/models'
import { getBackendConfig } from './backendConfig'
import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from './supabaseClient'
import {
  addStaffLoginAccount as addLocal,
  approveResetRequest as approveLocal,
  listResetRequests as listResetLocal,
  listStaffLoginAccounts as listLocal,
  setAccountRole as setLocalRole,
  setAccountStatus as setLocalStatus
} from './phoneLoginStore'
import { supabaseStaffLoginAccountAdapter, type CreateAccountInput } from './supabaseStaffLoginAccountAdapter'

/**
 * Unified staff-login-account service (admin registration). Routes to Supabase when
 * configured + logged in, else to the local-mock registry. NEVER creates Auth users
 * or sets passwords (that is the claim-phone-account Edge Function). Never logs
 * phones. Korean errors; RLS is the real access authority.
 */

export type StaffAdminDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface AccountsResult {
  ok: boolean
  mode: StaffAdminDataMode
  accounts: StaffLoginAccount[]
  error?: string
}
export interface ResetsResult {
  ok: boolean
  mode: StaffAdminDataMode
  requests: PasswordResetRequest[]
  error?: string
}
export interface MutationResult {
  ok: boolean
  mode: StaffAdminDataMode
  error?: string
  /** 비밀번호 재설정 승인 시 발급된 6자리 확인 코드(관리자가 직원에게 직접 전달). */
  approvalCode?: string
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}
function modeFromReason(reason?: string): StaffAdminDataMode {
  return reason === 'no-session' ? 'no-session' : reason === 'not-configured' ? 'not-configured' : 'supabase'
}

export async function listStaffLoginAccounts(): Promise<AccountsResult> {
  if (isSupabase()) {
    const res = await supabaseStaffLoginAccountAdapter.listAccounts()
    if (res.ok) return { ok: true, mode: 'supabase', accounts: res.data }
    return { ok: false, mode: modeFromReason(res.reason), accounts: [], error: res.message }
  }
  return { ok: true, mode: 'local-mock', accounts: listLocal() }
}

export interface CreateStaffInput extends CreateAccountInput {
  teamName?: string
}
export async function createStaffLoginAccount(input: CreateStaffInput): Promise<MutationResult> {
  if (isSupabase()) {
    const res = await supabaseStaffLoginAccountAdapter.createAccount(input)
    if (res.ok) return { ok: true, mode: 'supabase' }
    return { ok: false, mode: res.reason === 'duplicate' ? 'supabase' : modeFromReason(res.reason), error: res.message }
  }
  const r = addLocal({ name: input.name, phone: input.phone, role: input.role, teamName: input.teamName })
  return r.ok ? { ok: true, mode: 'local-mock' } : { ok: false, mode: 'local-mock', error: r.error }
}

/**
 * 관리자(owner/admin) 전용 — 등록과 동시에 초기 비밀번호를 지정해 즉시 로그인
 * 가능한 계정을 만든다(admin-create-staff-account 엣지 함수, 서버가 역할 재검증).
 * 초기 비밀번호를 쓰지 않는 등록은 기존 createStaffLoginAccount(초대) 경로 그대로.
 */
export async function createStaffAccountWithPassword(input: {
  name: string
  phone: string
  role: StaffRole
  password: string
}): Promise<MutationResult> {
  if (!isSupabase()) return { ok: false, mode: 'local-mock', error: '서버 연결 후 사용할 수 있습니다.' }
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, mode: 'not-configured', error: 'Supabase 설정이 없습니다.' }
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const token = (await client?.auth?.getSession())?.data?.session?.access_token
    if (!token) return { ok: false, mode: 'no-session', error: '로그인 세션이 없습니다.' }
    const res = await fetch(`${base}/admin-create-staff-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    if (res.ok && data?.ok) return { ok: true, mode: 'supabase' }
    return { ok: false, mode: 'supabase', error: data?.message ?? '계정 생성에 실패했습니다.' }
  } catch {
    return { ok: false, mode: 'supabase', error: '네트워크 상태를 확인해주세요.' }
  }
}

/**
 * 초기 비밀번호 없이 등록한 직원용 6자리 초대 코드를 발급한다(issue-staff-invite 엣지 함수).
 * 관리자·총무가 직원 본인에게 직접 전달하고, 직원은 로그인 화면에서 코드와 새 비밀번호를 입력한다.
 * 코드는 응답으로 한 번만 받으며 어디에도 저장하지 않는다.
 */
export async function issueStaffInviteCode(phone: string): Promise<{ ok: boolean; code?: string; error?: string }> {
  if (!isSupabase()) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: 'Supabase 설정이 없습니다.' }
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const token = (await client?.auth?.getSession())?.data?.session?.access_token
    if (!token) return { ok: false, error: '로그인 세션이 없습니다.' }
    const res = await fetch(`${base}/issue-staff-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone })
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: string }
    if (res.ok && data?.ok && data.code) return { ok: true, code: data.code }
    return { ok: false, error: data?.message ?? '초대 코드 발급에 실패했습니다.' }
  } catch {
    return { ok: false, error: '네트워크 상태를 확인해주세요.' }
  }
}

export async function updateStaffLoginRole(
  id: string,
  role: StaffRole,
  teamId?: string
): Promise<MutationResult> {
  if (isSupabase()) {
    const res = await supabaseStaffLoginAccountAdapter.updateRole(id, role, teamId)
    if (res.ok) return { ok: true, mode: 'supabase' }
    return { ok: false, mode: modeFromReason(res.reason), error: res.message }
  }
  setLocalRole(id, role)
  return { ok: true, mode: 'local-mock' }
}

export async function updateStaffLoginStatus(id: string, status: StaffLoginStatus): Promise<MutationResult> {
  if (isSupabase()) {
    const res = await supabaseStaffLoginAccountAdapter.updateStatus(id, status)
    if (res.ok) return { ok: true, mode: 'supabase' }
    return { ok: false, mode: modeFromReason(res.reason), error: res.message }
  }
  setLocalStatus(id, status)
  return { ok: true, mode: 'local-mock' }
}
export const deactivateStaffLoginAccount = (id: string): Promise<MutationResult> => updateStaffLoginStatus(id, 'inactive')
export const blockStaffLoginAccount = (id: string): Promise<MutationResult> => updateStaffLoginStatus(id, 'blocked')

export async function listPasswordResetRequests(): Promise<ResetsResult> {
  if (isSupabase()) {
    const res = await supabaseStaffLoginAccountAdapter.listResetRequests()
    if (res.ok) return { ok: true, mode: 'supabase', requests: res.data }
    return { ok: false, mode: modeFromReason(res.reason), requests: [], error: res.message }
  }
  return { ok: true, mode: 'local-mock', requests: listResetLocal() }
}

export async function approvePasswordResetRequest(id: string, approvedBy?: string): Promise<MutationResult> {
  if (isSupabase()) {
    const res = await supabaseStaffLoginAccountAdapter.approveReset(id)
    if (res.ok) return { ok: true, mode: 'supabase', approvalCode: res.data.approvalCode }
    return { ok: false, mode: modeFromReason(res.reason), error: res.message }
  }
  approveLocal(id, approvedBy)
  return { ok: true, mode: 'local-mock' }
}

export type { StaffRole }
