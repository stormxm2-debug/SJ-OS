import type { AnnouncementRecord, AnnouncementStatus, AnnouncementView } from '@shared/commercial/announcements'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase adapter for public.announcements + announcement_reads.
 *
 * SECURITY: anon public client only (never service_role). RLS is authoritative:
 * staff only receive published+targeted rows; only owner/admin can write
 * announcements; reads are per-current-profile only. Never logs sensitive data.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const COLS =
  'id, title, body, priority, target_type, target_role, target_team_id, status, pinned, created_by, published_at, created_at, updated_at'

export type AnnReason = 'not-configured' | 'no-session' | 'error'
export interface AnnOk<T> { ok: true; data: T }
export interface AnnErr { ok: false; reason: AnnReason; message: string }
export type AnnResult<T> = AnnOk<T> | AnnErr
function err(reason: AnnReason, message: string): AnnErr {
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
function nowIso(): string {
  return new Date().toISOString()
}

function mapRow(row: Record<string, unknown>): AnnouncementRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    priority: (row.priority as AnnouncementRecord['priority']) ?? 'normal',
    targetType: (row.target_type as AnnouncementRecord['targetType']) ?? 'all',
    targetRole: (row.target_role as AnnouncementRecord['targetRole']) ?? undefined,
    targetTeamId: (row.target_team_id as string | null) ?? undefined,
    status: (row.status as AnnouncementStatus) ?? 'draft',
    pinned: !!row.pinned,
    createdBy: String(row.created_by ?? ''),
    publishedAt: (row.published_at as string | null) ?? undefined,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  }
}

export const supabaseAnnouncementAdapter = {
  /** Published + targeted (RLS-enforced) with the current profile's read flags. */
  async listVisible(): Promise<AnnResult<AnnouncementView[]>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(c)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await c.from('announcements').select(COLS).eq('status', 'published').order('published_at', { ascending: false })
    if (error) return err('error', '공지사항을 불러오지 못했습니다.')
    let readIds = new Set<string>()
    try {
      const { data: rd } = await c.from('announcement_reads').select('announcement_id').eq('profile_id', userId)
      readIds = new Set((rd ?? []).map((r: any) => String(r.announcement_id)))
    } catch {
      /* reads best-effort */
    }
    return { ok: true, data: (data ?? []).map((r: any) => ({ ...mapRow(r), read: readIds.has(String(r.id)) })) }
  },

  /** All statuses (owner/admin; RLS-enforced). */
  async listAdmin(): Promise<AnnResult<AnnouncementRecord[]>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await c.from('announcements').select(COLS).order('updated_at', { ascending: false })
    if (error) return err('error', '공지사항 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async create(input: Partial<AnnouncementRecord>): Promise<AnnResult<AnnouncementRecord>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(c)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const publish = input.status === 'published'
    const row = {
      title: input.title?.trim(),
      body: input.body?.trim(),
      priority: input.priority ?? 'normal',
      target_type: input.targetType ?? 'all',
      target_role: input.targetType === 'role' ? input.targetRole : null,
      target_team_id: input.targetType === 'team' ? input.targetTeamId ?? null : null,
      status: input.status ?? 'draft',
      pinned: !!input.pinned,
      created_by: userId,
      published_at: publish ? nowIso() : null
    }
    const { data, error } = await c.from('announcements').insert(row).select(COLS).single()
    if (error) return err('error', '공지 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async update(id: string, input: Partial<AnnouncementRecord>): Promise<AnnResult<AnnouncementRecord>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const upd: Record<string, unknown> = { updated_at: nowIso() }
    if (input.title !== undefined) upd.title = input.title.trim()
    if (input.body !== undefined) upd.body = input.body.trim()
    if (input.priority !== undefined) upd.priority = input.priority
    if (input.targetType !== undefined) {
      upd.target_type = input.targetType
      upd.target_role = input.targetType === 'role' ? input.targetRole ?? null : null
      upd.target_team_id = input.targetType === 'team' ? input.targetTeamId ?? null : null
    }
    if (input.pinned !== undefined) upd.pinned = input.pinned
    const { data, error } = await c.from('announcements').update(upd).eq('id', id).select(COLS).single()
    if (error) return err('error', '공지 수정에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async setStatus(id: string, status: AnnouncementStatus): Promise<AnnResult<AnnouncementRecord>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const upd: Record<string, unknown> = { status, updated_at: nowIso() }
    if (status === 'published') upd.published_at = nowIso()
    const { data, error } = await c.from('announcements').update(upd).eq('id', id).select(COLS).single()
    if (error) return err('error', '상태 변경에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async remove(id: string): Promise<AnnResult<null>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { error } = await c.from('announcements').delete().eq('id', id)
    if (error) return err('error', '공지 삭제에 실패했습니다.')
    return { ok: true, data: null }
  },

  /** Insert a read record for the CURRENT profile only (upsert on unique). */
  async markRead(id: string): Promise<AnnResult<null>> {
    const c = await getClient()
    if (!c) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(c)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { error } = await c.from('announcement_reads').upsert({ announcement_id: id, profile_id: userId, read_at: nowIso() }, { onConflict: 'announcement_id,profile_id' })
    if (error) return err('error', '읽음 처리에 실패했습니다.')
    return { ok: true, data: null }
  }
}
