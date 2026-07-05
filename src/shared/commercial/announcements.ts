import type { StaffRole } from './models'

/**
 * Announcement (공지사항) models (shared). Owner/admin author; staff read targeted,
 * published notices. Final access is enforced by RLS; client filtering is UX support.
 */

export type AnnouncementPriority = 'normal' | 'important' | 'urgent'
export type AnnouncementTargetType = 'all' | 'role' | 'team'
export type AnnouncementStatus = 'draft' | 'published' | 'hidden' | 'archived'

export interface AnnouncementRecord {
  id: string
  title: string
  body: string
  priority: AnnouncementPriority
  targetType: AnnouncementTargetType
  targetRole?: StaffRole
  targetTeamId?: string
  targetTeamName?: string
  status: AnnouncementStatus
  pinned: boolean
  createdBy: string
  createdByName?: string
  publishedAt?: string
  createdAt: string
  updatedAt: string
  readCount?: number
}

export interface AnnouncementReadRecord {
  id: string
  announcementId: string
  profileId: string
  readAt: string
  createdAt: string
}

/** A visible announcement with the current user's read flag merged in. */
export interface AnnouncementView extends AnnouncementRecord {
  read: boolean
}

export const PRIORITY_LABEL: Record<AnnouncementPriority, string> = {
  normal: '일반',
  important: '중요',
  urgent: '긴급'
}
export const TARGET_LABEL: Record<AnnouncementTargetType, string> = {
  all: '전체공지',
  role: '역할공지',
  team: '팀공지'
}
export const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  draft: '임시저장',
  published: '게시됨',
  hidden: '숨김',
  archived: '보관'
}

export interface ViewerContext {
  role: StaffRole
  teamId?: string
  teamName?: string
}

/** UX visibility check (RLS is authoritative). Only published + targeted. */
export function isAnnouncementVisibleTo(a: AnnouncementRecord, v: ViewerContext): boolean {
  if (a.status !== 'published') return false
  if (a.targetType === 'all') return true
  if (a.targetType === 'role') return a.targetRole === v.role
  if (a.targetType === 'team') {
    return (
      (!!a.targetTeamId && a.targetTeamId === v.teamId) ||
      (!!a.targetTeamName && (a.targetTeamName === v.teamName || a.targetTeamName === v.teamId))
    )
  }
  return false
}

const PRIORITY_ORDER: Record<AnnouncementPriority, number> = { urgent: 0, important: 1, normal: 2 }

/** Sort: pinned first, then priority, then most recent. */
export function sortAnnouncements<T extends AnnouncementRecord>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    const at = Date.parse(a.publishedAt ?? a.createdAt) || 0
    const bt = Date.parse(b.publishedAt ?? b.createdAt) || 0
    return bt - at
  })
}
