/**
 * 콘텐츠 보드 모델 (순수 함수). 아이디어 → 제작 → 예약 → 게시 흐름.
 * 자동 게시는 하지 않는다. 예약 목록을 보고 사람이 직접 올리는 방식.
 */

export const CONTENT_STATUSES = ['idea', 'drafting', 'scheduled', 'published'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  idea: '아이디어',
  drafting: '제작 중',
  scheduled: '예약됨',
  published: '게시됨'
}

export const PLATFORMS = ['instagram_reels', 'youtube_shorts', 'tiktok', 'instagram_feed', 'threads', 'x', 'linkedin'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram_reels: '인스타 릴스',
  youtube_shorts: '유튜브 쇼츠',
  tiktok: '틱톡',
  instagram_feed: '인스타 피드',
  threads: '스레드',
  x: 'X',
  linkedin: '링크드인'
}

export interface ContentItem {
  id: string
  title: string
  body: string
  platforms: Platform[]
  status: ContentStatus
  /** 예약·게시 예정 시각(ISO). 없으면 날짜 미정. */
  scheduledAt?: string
  updatedAt: string
}

export const CONTENT_TITLE_MAX = 100
export const CONTENT_BODY_MAX = 5000

export function validateContent(input: { title: string; body: string; platforms: string[]; status: string; scheduledAt?: string }): { ok: boolean; error?: string } {
  if (!input.title.trim()) return { ok: false, error: '제목을 입력해 주세요.' }
  if (input.title.length > CONTENT_TITLE_MAX) return { ok: false, error: `제목은 ${CONTENT_TITLE_MAX}자 이내여야 합니다.` }
  if (input.body.length > CONTENT_BODY_MAX) return { ok: false, error: `내용은 ${CONTENT_BODY_MAX}자 이내여야 합니다.` }
  if (!(CONTENT_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: '상태가 올바르지 않습니다.' }
  if (input.platforms.some((p) => !(PLATFORMS as readonly string[]).includes(p))) return { ok: false, error: '플랫폼이 올바르지 않습니다.' }
  if (input.scheduledAt && Number.isNaN(Date.parse(input.scheduledAt))) return { ok: false, error: '예약 시각 형식이 올바르지 않습니다.' }
  return { ok: true }
}

/** 예약 시각이 가까운 순, 날짜 미정은 뒤로. 원본은 바꾸지 않는다. */
export function sortByScheduled(list: ContentItem[]): ContentItem[] {
  return [...list].sort((a, b) => {
    const at = a.scheduledAt ? Date.parse(a.scheduledAt) : Number.POSITIVE_INFINITY
    const bt = b.scheduledAt ? Date.parse(b.scheduledAt) : Number.POSITIVE_INFINITY
    if (at !== bt) return at - bt
    return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
  })
}

/** 상태별 개수 (보드 상단 요약용). */
export function countByStatus(list: ContentItem[]): Record<ContentStatus, number> {
  const out: Record<ContentStatus, number> = { idea: 0, drafting: 0, scheduled: 0, published: 0 }
  for (const c of list) out[c.status] += 1
  return out
}
