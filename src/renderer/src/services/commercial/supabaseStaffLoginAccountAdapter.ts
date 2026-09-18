import type { PasswordResetRequest, StaffLoginAccount, StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { StaffRole } from '@shared/commercial/models'
import { normalizeKoreanPhoneNumber } from '@shared/phone'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase adapter for public.staff_login_accounts + password_reset_requests.
 *
 * SECURITY: anon public client only (never service_role). RLS restricts these tables
 * to owner/admin — this adapter NEVER creates Supabase Auth users and NEVER sets
 * passwords (that is the claim-phone-account Edge Function). Never logs phone
 * numbers. Registering here only adds the allowed-phone ENTRY GATE row.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACCT_COLS = 'id, name, phone, normalized_phone, role, team_id, status, password_status, profile_id, created_at, updated_at'
const RESET_COLS = 'id, normalized_phone, status, requested_at, approved_at, approved_by, note'

export type AdapterReason = 'not-configured' | 'no-session' | 'error' | 'duplicate'
export interface AdapterOk<T> { ok: true; data: T }
export interface AdapterErr { ok: false; reason: AdapterReason; message: string }
export type AdapterResult<T> = AdapterOk<T> | AdapterErr
function err(reason: AdapterReason, message: string): AdapterErr {
  return { ok: false, reason, message }
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
async function currentUserId(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

function mapAccount(row: Record<string, unknown>): StaffLoginAccount {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? ''),
    normalizedPhone: String(row.normalized_phone ?? ''),
    role: (row.role as StaffRole) ?? 'fc',
    teamId: (row.team_id as string | null) ?? undefined,
    status: (row.status as StaffLoginStatus) ?? 'invited',
    passwordStatus: (row.password_status as StaffLoginAccount['passwordStatus']) ?? 'not-set',
    profileId: (row.profile_id as string | null) ?? undefined,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  }
}
function mapReset(row: Record<string, unknown>): PasswordResetRequest {
  return {
    id: String(row.id),
    normalizedPhone: String(row.normalized_phone ?? ''),
    status: (row.status as PasswordResetRequest['status']) ?? 'pending',
    requestedAt: String(row.requested_at ?? ''),
    approvedAt: (row.approved_at as string | null) ?? undefined,
    approvedBy: (row.approved_by as string | null) ?? undefined,
    note: (row.note as string | null) ?? undefined
  }
}

export interface CreateAccountInput {
  name: string
  phone: string
  role: StaffRole
  teamId?: string
}

export const supabaseStaffLoginAccountAdapter = {
  async listAccounts(): Promise<AdapterResult<StaffLoginAccount[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('staff_login_accounts').select(ACCT_COLS).order('created_at', { ascending: false })
    if (error) return err('error', '직원 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapAccount) }
  },

  async createAccount(input: CreateAccountInput): Promise<AdapterResult<StaffLoginAccount>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const norm = normalizeKoreanPhoneNumber(input.phone)
    if (!norm.ok || !norm.value) return err('error', norm.error ?? '휴대폰 번호 형식을 확인해주세요.')
    const row = {
      name: input.name.trim(),
      phone: input.phone.trim(),
      normalized_phone: norm.value,
      role: input.role,
      team_id: input.teamId ?? null,
      status: 'invited', // never creates an Auth user / sets a password here
      password_status: 'not-set',
      created_by: userId
    }
    const { data, error } = await client.from('staff_login_accounts').insert(row).select(ACCT_COLS).single()
    if (error) {
      // 23505 = unique_violation on normalized_phone
      if ((error as { code?: string }).code === '23505') return err('duplicate', '이미 등록된 휴대폰 번호입니다.')
      return err('error', '직원 등록에 실패했습니다.')
    }
    return { ok: true, data: mapAccount(data) }
  },

  async updateRole(id: string, role: StaffRole, teamId?: string): Promise<AdapterResult<StaffLoginAccount>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const patch: Record<string, unknown> = { role, updated_at: new Date().toISOString() }
    if (teamId !== undefined) patch.team_id = teamId ?? null
    const { data, error } = await client
      .from('staff_login_accounts')
      .update(patch)
      .eq('id', id)
      .select(ACCT_COLS)
      .single()
    if (error) return err('error', '역할 변경에 실패했습니다.')
    const acct = mapAccount(data)
    // 이미 첫 로그인(claim)한 계정은 profiles.role이 고정돼 있으므로 함께 갱신한다.
    // RLS(profiles_admin_manage: is_owner_or_admin)로 owner/admin만 이 갱신이 허용된다.
    if (acct.profileId) {
      const profilePatch: Record<string, unknown> = { role }
      if (teamId !== undefined) profilePatch.team_id = teamId ?? null
      const { error: pErr } = await client.from('profiles').update(profilePatch).eq('id', acct.profileId)
      if (pErr) {
        return err(
          'error',
          '직원 계정 역할은 바꿨지만, 이미 로그인한 계정의 프로필 권한 반영에 실패했습니다. (관리자 권한/RLS 확인 필요)'
        )
      }
    }
    return { ok: true, data: acct }
  },

  async updateStatus(id: string, status: StaffLoginStatus): Promise<AdapterResult<StaffLoginAccount>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await client
      .from('staff_login_accounts')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(ACCT_COLS)
      .single()
    if (error) return err('error', '상태 변경에 실패했습니다.')
    return { ok: true, data: mapAccount(data) }
  },

  async listResetRequests(): Promise<AdapterResult<PasswordResetRequest[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await client.from('password_reset_requests').select(RESET_COLS).order('requested_at', { ascending: false })
    if (error) return err('error', '재설정 요청을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapReset) }
  },

  async approveReset(id: string): Promise<AdapterResult<PasswordResetRequest & { approvalCode: string }>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    // 전화번호만 아는 제3자가 승인된 재설정을 가로채지 못하도록, 승인할 때 6자리 확인 코드를
    // 발급한다. 관리자가 직원 본인에게 직접 전달하고, 서버(claim-phone-account)는 코드가
    // 맞을 때만 새 비밀번호를 적용한다. DB에는 코드 대신 해시만 저장한다(관리자만 조회 가능).
    const approvalCode = newApprovalCode()
    const approvalCodeHash = await approvalCodeDigest(id, approvalCode)
    const { data, error } = await client
      .from('password_reset_requests')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userId,
        approval_code_hash: approvalCodeHash,
        failed_attempts: 0
      })
      .eq('id', id)
      .select(RESET_COLS)
      .single()
    if (error) return err('error', '재설정 승인에 실패했습니다.')
    // 승인과 동시에 로그인 게이트를 '재설정 대기'로 바꿔야 해당 직원의 로그인
    // 화면에 새 비밀번호 설정 칸이 뜬다(phone_login_gate가 이 상태를 본다).
    // 실제 비밀번호 변경 자체는 서버(claim-phone-account)가 승인 기록을 다시
    // 검증하므로, 이 갱신이 실패해도 보안 문제는 없고 안내만 늦어진다.
    try {
      await client
        .from('staff_login_accounts')
        .update({ password_status: 'reset-approved', updated_at: new Date().toISOString() })
        .eq('normalized_phone', (data as { normalized_phone?: string }).normalized_phone ?? '')
    } catch {
      /* 게이트 갱신 실패는 치명적이지 않음 */
    }
    return { ok: true, data: { ...mapReset(data), approvalCode } }
  }
}

function newApprovalCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

// 서버(claim-phone-account)와 같은 방식: sha256(`${요청 id}:${코드}`)의 16진수.
async function approvalCodeDigest(requestId: string, code: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${requestId}:${code}`))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
