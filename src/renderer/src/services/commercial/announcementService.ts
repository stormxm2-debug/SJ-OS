import type { AnnouncementRecord, AnnouncementStatus, AnnouncementView, ViewerContext } from '@shared/commercial/announcements'
import { isAnnouncementVisibleTo, sortAnnouncements } from '@shared/commercial/announcements'
import { getBackendConfig } from './backendConfig'
import {
  createLocalAnnouncement,
  deleteLocalAnnouncement,
  listLocalAnnouncements,
  localReadIds,
  markLocalRead,
  setLocalAnnouncementStatus,
  updateLocalAnnouncement
} from './announcementsStore'
import { supabaseAnnouncementAdapter } from './supabaseAnnouncementAdapter'

/**
 * Unified announcement service. Routes to Supabase when configured + logged in, else
 * local-mock. Staff see only published+targeted notices (RLS + client filter);
 * owner/admin manage all. Never uses service_role, never logs sensitive data.
 */

export type AnnDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface VisibleResult {
  ok: boolean
  mode: AnnDataMode
  announcements: AnnouncementView[]
  error?: string
}
export interface AdminResult {
  ok: boolean
  mode: AnnDataMode
  announcements: AnnouncementRecord[]
  error?: string
}
export interface AnnMutation {
  ok: boolean
  mode: AnnDataMode
  error?: string
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}

export async function listVisibleAnnouncements(viewer: ViewerContext): Promise<VisibleResult> {
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.listVisible()
    if (res.ok) {
      // Server RLS already scopes; client re-filter is UX-only defense in depth.
      const visible = res.data.filter((a) => isAnnouncementVisibleTo(a, viewer))
      return { ok: true, mode: 'supabase', announcements: sortAnnouncements(visible) }
    }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : res.reason === 'not-configured' ? 'not-configured' : 'supabase', announcements: [], error: res.message }
  }
  const readIds = new Set(localReadIds())
  const visible = listLocalAnnouncements()
    .filter((a) => isAnnouncementVisibleTo(a, viewer))
    .map((a) => ({ ...a, read: readIds.has(a.id) }))
  return { ok: true, mode: 'local-mock', announcements: sortAnnouncements(visible) }
}

export async function listAdminAnnouncements(): Promise<AdminResult> {
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.listAdmin()
    if (res.ok) return { ok: true, mode: 'supabase', announcements: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', announcements: [], error: res.message }
  }
  return { ok: true, mode: 'local-mock', announcements: sortAnnouncements(listLocalAnnouncements()) }
}

export interface CreateAnnInput {
  title: string
  body: string
  priority: AnnouncementRecord['priority']
  targetType: AnnouncementRecord['targetType']
  targetRole?: AnnouncementRecord['targetRole']
  targetTeamId?: string
  targetTeamName?: string
  pinned: boolean
  status: 'draft' | 'published'
  createdBy: string
  createdByName?: string
}

export async function createAnnouncement(input: CreateAnnInput): Promise<AnnMutation> {
  if (!input.title.trim() || !input.body.trim()) return { ok: false, mode: isSupabase() ? 'supabase' : 'local-mock', error: '제목과 내용을 입력해주세요.' }
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.create(input)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  const now = new Date().toISOString()
  createLocalAnnouncement({
    title: input.title.trim(),
    body: input.body.trim(),
    priority: input.priority,
    targetType: input.targetType,
    targetRole: input.targetType === 'role' ? input.targetRole : undefined,
    targetTeamId: input.targetType === 'team' ? input.targetTeamId : undefined,
    targetTeamName: input.targetType === 'team' ? input.targetTeamName : undefined,
    status: input.status,
    pinned: input.pinned,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    publishedAt: input.status === 'published' ? now : undefined
  })
  return { ok: true, mode: 'local-mock' }
}

export async function updateAnnouncement(id: string, input: Partial<AnnouncementRecord>): Promise<AnnMutation> {
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.update(id, input)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  updateLocalAnnouncement(id, input)
  return { ok: true, mode: 'local-mock' }
}

async function setStatus(id: string, status: AnnouncementStatus): Promise<AnnMutation> {
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.setStatus(id, status)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  setLocalAnnouncementStatus(id, status)
  return { ok: true, mode: 'local-mock' }
}
export const publishAnnouncement = (id: string): Promise<AnnMutation> => setStatus(id, 'published')
export const hideAnnouncement = (id: string): Promise<AnnMutation> => setStatus(id, 'hidden')
export const archiveAnnouncement = (id: string): Promise<AnnMutation> => setStatus(id, 'archived')

export async function deleteAnnouncement(id: string): Promise<AnnMutation> {
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.remove(id)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  deleteLocalAnnouncement(id)
  return { ok: true, mode: 'local-mock' }
}

export async function markAnnouncementRead(id: string): Promise<AnnMutation> {
  if (isSupabase()) {
    const res = await supabaseAnnouncementAdapter.markRead(id)
    return res.ok ? { ok: true, mode: 'supabase' } : { ok: false, mode: 'supabase', error: res.message }
  }
  markLocalRead(id)
  return { ok: true, mode: 'local-mock' }
}

export async function getUnreadAnnouncementCount(viewer: ViewerContext): Promise<number> {
  const res = await listVisibleAnnouncements(viewer)
  return res.announcements.filter((a) => !a.read).length
}
