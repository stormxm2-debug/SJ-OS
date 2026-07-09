import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 공유 일정 게시판 (shared_schedules) — 개인 일정(schedule_events)과 분리된
 * 전 직원 공용 보드. 개인 일정은 본인+관리자만 보이도록 좁혀졌고(대표 지시),
 * 서로 알려야 하는 일정은 여기에 올린다.
 *
 * RLS: 조회 = 로그인 직원 전체 / 등록 = 본인 / 삭제·수정 = 본인 or 관리자.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SharedSchedule {
  id: string
  staffId: string
  staffName: string
  title: string
  detail?: string
  startsAt: string
  location?: string
  createdAt: string
}

export interface SharedScheduleInput {
  title: string
  startsAt: string
  detail?: string
  location?: string
}

const COLS = 'id, staff_id, title, detail, starts_at, location, created_at, staff:profiles(id, name)'

function mapRow(row: any): SharedSchedule {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff?.name ?? '(이름없음)',
    title: row.title ?? '',
    detail: row.detail ?? undefined,
    startsAt: row.starts_at,
    location: row.location ?? undefined,
    createdAt: row.created_at
  }
}

async function db(): Promise<any | null> {
  await initSupabaseClient()
  return getSupabaseClient() as any
}

export async function listSharedSchedules(): Promise<{ ok: boolean; items: SharedSchedule[]; error?: string }> {
  const client = await db()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 사용할 수 있습니다.' }
  const { data, error } = await client.from('shared_schedules').select(COLS).order('starts_at', { ascending: false }).limit(200)
  if (error) return { ok: false, items: [], error: '공유 일정을 불러오지 못했습니다.' }
  return { ok: true, items: ((data as any[]) ?? []).map(mapRow) }
}

export async function addSharedSchedule(input: SharedScheduleInput): Promise<{ ok: boolean; error?: string }> {
  const client = await db()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { data: sess } = await client.auth.getSession()
  const uid: string | undefined = sess?.session?.user?.id
  if (!uid) return { ok: false, error: '로그인 후 등록할 수 있습니다.' }
  const { error } = await client.from('shared_schedules').insert({
    staff_id: uid,
    title: input.title.trim(),
    detail: input.detail?.trim() || null,
    starts_at: input.startsAt,
    location: input.location?.trim() || null
  })
  if (error) return { ok: false, error: '등록에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  return { ok: true }
}

export async function deleteSharedSchedule(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await db()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { data, error } = await client.from('shared_schedules').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: '삭제에 실패했습니다.' }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, error: '삭제 권한이 없습니다. (본인 글 또는 관리자만)' }
  return { ok: true }
}
