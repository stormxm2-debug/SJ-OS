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

  async approveReset(id: string): Promise<AdapterResult<PasswordResetRequest>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    const { data, error } = await client
      .from('password_reset_requests')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: userId })
      .eq('id', id)
      .select(RESET_COLS)
      .single()
    if (error) return err('error', '재설정 승인에 실패했습니다.')
    return { ok: true, data: mapReset(data) }
  }
}
