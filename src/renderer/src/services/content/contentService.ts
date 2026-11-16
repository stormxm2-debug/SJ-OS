import { getSupabaseClient, initSupabaseClient } from '../commercial/supabaseClient'
import type { ContentItem, ContentStatus, Platform } from './contentModel'

/**
 * 콘텐츠 보드 저장소 (content_items). 대표 본인만 접근(RLS). 내용은 로그에 남기지 않는다.
 * 테이블이 아직 없으면(마이그레이션 전) 'not-ready' 로 돌려 화면이 안내한다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ContentReason = 'not-configured' | 'no-session' | 'not-ready' | 'error'
export type ContentResult<T> = { ok: true; data: T } | { ok: false; reason: ContentReason; message: string }

const COLS = 'id, title, body, platforms, status, scheduled_at, updated_at'

async function client(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
async function userId(c: any): Promise<string | null> {
  try {
    const { data } = await c.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}
function fail(reason: ContentReason, message: string): { ok: false; reason: ContentReason; message: string } {
  return { ok: false, reason, message }
}
function classify(error: any): ContentReason {
  const code = String(error?.code ?? '')
  const msg = String(error?.message ?? '')
  if (code === '42P01' || (/content_items/.test(msg) && /does not exist|schema cache/i.test(msg))) return 'not-ready'
  return 'error'
}
function toItem(r: Record<string, unknown>): ContentItem {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    platforms: ((r.platforms as string[] | null) ?? []) as Platform[],
    status: (r.status as ContentStatus) ?? 'idea',
    scheduledAt: (r.scheduled_at as string | null) ?? undefined,
    updatedAt: String(r.updated_at ?? '')
  }
}

export async function listContent(): Promise<ContentResult<ContentItem[]>> {
  const c = await client()
  if (!c) return fail('not-configured', '서버 설정이 없습니다.')
  if (!(await userId(c))) return fail('no-session', '로그인 세션이 없습니다.')
  const { data, error } = await c.from('content_items').select(COLS).order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) {
    const reason = classify(error)
    return fail(reason, reason === 'not-ready' ? '콘텐츠 보드는 서버 설정(DB 적용) 후 사용할 수 있습니다.' : '콘텐츠를 불러오지 못했습니다.')
  }
  return { ok: true, data: (data ?? []).map(toItem) }
}

export async function saveContent(input: {
  id?: string
  title: string
  body: string
  platforms: Platform[]
  status: ContentStatus
  scheduledAt?: string
}): Promise<ContentResult<ContentItem>> {
  const c = await client()
  if (!c) return fail('not-configured', '서버 설정이 없습니다.')
  const uid = await userId(c)
  if (!uid) return fail('no-session', '로그인 세션이 없습니다.')
  const row = {
    title: input.title.trim(),
    body: input.body,
    platforms: input.platforms,
    status: input.status,
    scheduled_at: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
    updated_at: new Date().toISOString()
  }
  const q = input.id
    ? c.from('content_items').update(row).eq('id', input.id).select(COLS).single()
    : c.from('content_items').insert({ ...row, owner_id: uid }).select(COLS).single()
  const { data, error } = await q
  if (error) {
    const reason = classify(error)
    return fail(reason, reason === 'not-ready' ? '콘텐츠 보드는 서버 설정(DB 적용) 후 사용할 수 있습니다.' : '저장에 실패했습니다. 다시 시도해 주세요.')
  }
  return { ok: true, data: toItem(data) }
}

export async function deleteContent(id: string): Promise<ContentResult<null>> {
  const c = await client()
  if (!c) return fail('not-configured', '서버 설정이 없습니다.')
  if (!(await userId(c))) return fail('no-session', '로그인 세션이 없습니다.')
  const { data, error } = await c.from('content_items').delete().eq('id', id).select('id')
  if (error) return fail('error', '삭제에 실패했습니다.')
  if (!Array.isArray(data) || data.length === 0) return fail('error', '삭제할 항목을 찾을 수 없습니다.')
  return { ok: true, data: null }
}
