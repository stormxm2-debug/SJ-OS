import { getSupabaseClient, initSupabaseClient } from '../commercial/supabaseClient'
import type { MemoItem } from './memoModel'

/**
 * 개인 메모 저장소 (staff_memos). 본인 행만 접근(RLS). 메모 내용은 로그에 남기지 않는다.
 * 테이블이 아직 없으면(마이그레이션 전) 'not-ready' 로 돌려 화면이 안내할 수 있게 한다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MemoReason = 'not-configured' | 'no-session' | 'not-ready' | 'error'
export type MemoResult<T> = { ok: true; data: T } | { ok: false; reason: MemoReason; message: string }

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
function fail(reason: MemoReason, message: string): { ok: false; reason: MemoReason; message: string } {
  return { ok: false, reason, message }
}
function classify(error: any): MemoReason {
  const msg = String(error?.message ?? '')
  const code = String(error?.code ?? '')
  // 42P01 = undefined_table (마이그레이션 미적용)
  if (code === '42P01' || /staff_memos/.test(msg) && /does not exist|schema cache/i.test(msg)) return 'not-ready'
  return 'error'
}
function toItem(r: Record<string, unknown>): MemoItem {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    pinned: !!r.pinned,
    updatedAt: String(r.updated_at ?? r.created_at ?? '')
  }
}

export async function listMemos(): Promise<MemoResult<MemoItem[]>> {
  const c = await client()
  if (!c) return fail('not-configured', '서버 설정이 없습니다.')
  if (!(await userId(c))) return fail('no-session', '로그인 세션이 없습니다.')
  const { data, error } = await c.from('staff_memos').select('id, title, body, pinned, updated_at, created_at').order('updated_at', { ascending: false })
  if (error) {
    const reason = classify(error)
    return fail(reason, reason === 'not-ready' ? '메모 기능은 서버 설정(DB 적용) 후 사용할 수 있습니다.' : '메모를 불러오지 못했습니다.')
  }
  return { ok: true, data: (data ?? []).map(toItem) }
}

export async function saveMemo(input: { id?: string; title: string; body: string; pinned: boolean }): Promise<MemoResult<MemoItem>> {
  const c = await client()
  if (!c) return fail('not-configured', '서버 설정이 없습니다.')
  const uid = await userId(c)
  if (!uid) return fail('no-session', '로그인 세션이 없습니다.')
  const row = { title: input.title.trim(), body: input.body, pinned: input.pinned, updated_at: new Date().toISOString() }
  const q = input.id
    ? c.from('staff_memos').update(row).eq('id', input.id).select('id, title, body, pinned, updated_at, created_at').single()
    : c.from('staff_memos').insert({ ...row, staff_id: uid }).select('id, title, body, pinned, updated_at, created_at').single()
  const { data, error } = await q
  if (error) {
    const reason = classify(error)
    return fail(reason, reason === 'not-ready' ? '메모 기능은 서버 설정(DB 적용) 후 사용할 수 있습니다.' : '메모 저장에 실패했습니다. 다시 시도해 주세요.')
  }
  return { ok: true, data: toItem(data) }
}

export async function deleteMemo(id: string): Promise<MemoResult<null>> {
  const c = await client()
  if (!c) return fail('not-configured', '서버 설정이 없습니다.')
  if (!(await userId(c))) return fail('no-session', '로그인 세션이 없습니다.')
  const { data, error } = await c.from('staff_memos').delete().eq('id', id).select('id')
  if (error) return fail('error', '메모 삭제에 실패했습니다.')
  if (!Array.isArray(data) || data.length === 0) return fail('error', '삭제할 메모를 찾을 수 없습니다.')
  return { ok: true, data: null }
}
