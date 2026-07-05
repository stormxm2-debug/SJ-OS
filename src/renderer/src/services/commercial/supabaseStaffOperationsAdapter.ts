import type { StaffRole } from '@shared/commercial/models'
import type { StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { TeamRecord } from '@shared/commercial/teamOps'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase adapter for team + staff operations (owner/admin, RLS-enforced).
 *
 * SECURITY: anon public client only (never service_role). Updates staff_login_accounts
 * and, when linked, profiles. Never creates Auth users, never sets passwords, never
 * logs phone numbers. RLS restricts these tables to owner/admin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type OpReason = 'not-configured' | 'no-session' | 'error'
export interface OpOk<T> { ok: true; data: T }
export interface OpErr { ok: false; reason: OpReason; message: string }
export type OpResult<T> = OpOk<T> | OpErr
function err(reason: OpReason, message: string): OpErr {
  return { ok: false, reason, message }
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
function nowIso(): string {
  return new Date().toISOString()
}

function mapTeam(row: Record<string, unknown>): TeamRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    leaderId: (row.leader_id as string | null) ?? undefined,
    status: (row.status as TeamRecord['status']) ?? 'active',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  }
}

export const supabaseStaffOperationsAdapter = {
  async listTeams(): Promise<OpResult<TeamRecord[]>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await c.from('teams').select('id, name, leader_id, status, created_at, updated_at').order('created_at', { ascending: false })
    if (error) return err('error', '팀 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapTeam) }
  },

  async createTeam(name: string): Promise<OpResult<TeamRecord>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await c.from('teams').insert({ name: name.trim() }).select('id, name, leader_id, status, created_at, updated_at').single()
    if (error) return err('error', '팀 생성에 실패했습니다.')
    return { ok: true, data: mapTeam(data) }
  },

  async updateTeam(id: string, patch: { name?: string; status?: TeamRecord['status']; leaderId?: string | null }): Promise<OpResult<TeamRecord>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const upd: Record<string, unknown> = { updated_at: nowIso() }
    if (patch.name !== undefined) upd.name = patch.name.trim()
    if (patch.status !== undefined) upd.status = patch.status
    if (patch.leaderId !== undefined) upd.leader_id = patch.leaderId
    const { data, error } = await c.from('teams').update(upd).eq('id', id).select('id, name, leader_id, status, created_at, updated_at').single()
    if (error) return err('error', '팀 정보 변경에 실패했습니다.')
    return { ok: true, data: mapTeam(data) }
  },

  /** Update role on staff_login_accounts (+ profiles if linked). */
  async updateStaffRole(loginAccountId: string, role: StaffRole, profileId?: string): Promise<OpResult<null>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { error } = await c.from('staff_login_accounts').update({ role, updated_at: nowIso() }).eq('id', loginAccountId)
    if (error) return err('error', '역할 변경에 실패했습니다.')
    if (profileId) await c.from('profiles').update({ role, updated_at: nowIso() }).eq('id', profileId)
    return { ok: true, data: null }
  },

  async updateStaffTeam(loginAccountId: string, teamId: string | null, profileId?: string): Promise<OpResult<null>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { error } = await c.from('staff_login_accounts').update({ team_id: teamId, updated_at: nowIso() }).eq('id', loginAccountId)
    if (error) return err('error', '팀 배정에 실패했습니다.')
    if (profileId) await c.from('profiles').update({ team_id: teamId, updated_at: nowIso() }).eq('id', profileId)
    return { ok: true, data: null }
  },

  async updateStaffStatus(loginAccountId: string, status: StaffLoginStatus, profileId?: string): Promise<OpResult<null>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { error } = await c.from('staff_login_accounts').update({ status, updated_at: nowIso() }).eq('id', loginAccountId)
    if (error) return err('error', '상태 변경에 실패했습니다.')
    if (profileId) {
      const profileStatus = status === 'active' ? 'active' : 'inactive'
      await c.from('profiles').update({ status: profileStatus, updated_at: nowIso() }).eq('id', profileId)
    }
    return { ok: true, data: null }
  }
}
