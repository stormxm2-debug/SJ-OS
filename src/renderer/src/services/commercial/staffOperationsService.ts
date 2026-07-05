import type { StaffRole } from '@shared/commercial/models'
import type { StaffLoginAccount, StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { OrganizationSummary, StaffManagementRecord, TeamRecord } from '@shared/commercial/teamOps'
import { maskKoreanPhoneDisplay } from '@shared/phone'
import { getBackendConfig } from './backendConfig'
import { listStaffLoginAccounts } from './staffLoginAccountService'
import {
  setAccountRole,
  setAccountStatus,
  setAccountTeam
} from './phoneLoginStore'
import {
  createLocalTeam,
  listLocalTeams,
  renameLocalTeam,
  setLocalTeamLeader,
  setLocalTeamStatus
} from './teamsStore'
import { supabaseStaffOperationsAdapter } from './supabaseStaffOperationsAdapter'

/**
 * Unified staff/team operations service (owner/admin). Routes to Supabase when
 * configured, else local-mock. Never creates Auth users / sets passwords / uses
 * service_role. Phones are masked; nothing sensitive is logged. RLS is authoritative.
 */

export type OpsDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface StaffResult {
  ok: boolean
  mode: OpsDataMode
  staff: StaffManagementRecord[]
  error?: string
}
export interface TeamsResult {
  ok: boolean
  mode: OpsDataMode
  teams: TeamRecord[]
  error?: string
}
export interface OpMutation {
  ok: boolean
  mode: OpsDataMode
  error?: string
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}

function toManagement(a: StaffLoginAccount): StaffManagementRecord {
  return {
    id: a.id,
    profileId: a.profileId,
    loginAccountId: a.id,
    name: a.name,
    phoneMasked: maskKoreanPhoneDisplay(a.normalizedPhone),
    role: a.role,
    teamId: a.teamId,
    teamName: a.teamName,
    status: a.status,
    passwordStatus: a.passwordStatus,
    profileLinked: !!a.profileId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  }
}

export async function listStaff(): Promise<StaffResult> {
  const res = await listStaffLoginAccounts()
  return { ok: res.ok, mode: res.mode as OpsDataMode, staff: res.accounts.map(toManagement), error: res.error }
}

export async function listTeams(): Promise<TeamsResult> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.listTeams()
    if (res.ok) return { ok: true, mode: 'supabase', teams: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : res.reason === 'not-configured' ? 'not-configured' : 'supabase', teams: [], error: res.message }
  }
  return { ok: true, mode: 'local-mock', teams: listLocalTeams() }
}

export async function createTeam(name: string): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.createTeam(name)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  const r = createLocalTeam(name)
  return r.ok ? { ok: true, mode: 'local-mock' } : { ok: false, mode: 'local-mock', error: r.error }
}
export async function renameTeam(id: string, name: string): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.updateTeam(id, { name })
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  renameLocalTeam(id, name)
  return { ok: true, mode: 'local-mock' }
}
export async function deactivateTeam(id: string): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.updateTeam(id, { status: 'inactive' })
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  setLocalTeamStatus(id, 'inactive')
  return { ok: true, mode: 'local-mock' }
}
export async function setTeamLeader(teamId: string, staff: StaffManagementRecord): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.updateTeam(teamId, { leaderId: staff.profileId ?? null })
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  setLocalTeamLeader(teamId, staff.id, staff.name)
  return { ok: true, mode: 'local-mock' }
}

export async function updateStaffRole(staff: StaffManagementRecord, role: StaffRole): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.updateStaffRole(staff.loginAccountId ?? staff.id, role, staff.profileId)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  setAccountRole(staff.id, role)
  return { ok: true, mode: 'local-mock' }
}
export async function updateStaffTeam(staff: StaffManagementRecord, teamId: string | null, teamName?: string): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.updateStaffTeam(staff.loginAccountId ?? staff.id, teamId, staff.profileId)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  setAccountTeam(staff.id, teamId ?? undefined, teamName)
  return { ok: true, mode: 'local-mock' }
}
export async function updateStaffStatus(staff: StaffManagementRecord, status: StaffLoginStatus): Promise<OpMutation> {
  if (isSupabase()) {
    const res = await supabaseStaffOperationsAdapter.updateStaffStatus(staff.loginAccountId ?? staff.id, status, staff.profileId)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  setAccountStatus(staff.id, status)
  return { ok: true, mode: 'local-mock' }
}

export function getOrganizationSummary(staff: StaffManagementRecord[], teams: TeamRecord[]): OrganizationSummary {
  return {
    totalStaff: staff.length,
    activeStaff: staff.filter((s) => s.status === 'active').length,
    invited: staff.filter((s) => s.status === 'invited').length,
    passwordNotSet: staff.filter((s) => s.passwordStatus === 'not-set').length,
    teamCount: teams.filter((t) => t.status === 'active').length,
    inactiveOrBlocked: staff.filter((s) => s.status === 'inactive' || s.status === 'blocked').length
  }
}
