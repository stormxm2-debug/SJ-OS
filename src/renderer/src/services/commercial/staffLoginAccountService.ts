import type { PasswordResetRequest, StaffLoginAccount, StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { StaffRole } from '@shared/commercial/models'
import { getBackendConfig } from './backendConfig'
import {
  addStaffLoginAccount as addLocal,
  approveResetRequest as approveLocal,
  listResetRequests as listResetLocal,
  listStaffLoginAccounts as listLocal,
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
    if (res.ok) return { ok: true, mode: 'supabase' }
    return { ok: false, mode: modeFromReason(res.reason), error: res.message }
  }
  approveLocal(id, approvedBy)
  return { ok: true, mode: 'local-mock' }
}

export type { StaffRole }
