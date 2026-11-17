import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 출퇴근 부가기능 — 직출 보고서(승인제) + 잠시 멈춤(토글).
 * RLS 가 실제 경계(관리자 승인/멈춤, FC 본인 제출). 클라 필터는 UX 용.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

async function client(): Promise<any | null> {
  try {
    await initSupabaseClient()
    return getSupabaseClient() as any
  } catch {
    return null
  }
}

// ── 직출 보고서 ────────────────────────────────────────────────
export type JikchulStatus = 'pending' | 'approved' | 'rejected'
export interface JikchulReport {
  id: string
  staffId: string
  staffName: string | null
  forDate: string // YYYY-MM-DD
  destination: string | null
  reason: string | null
  status: JikchulStatus
  reviewedAt: string | null
  reviewNote: string | null
  createdAt: string
}

const JK_COLS = 'id, staff_id, staff_name, for_date, destination, reason, status, reviewed_by, reviewed_at, review_note, created_at'

function mapJk(r: any): JikchulReport {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name ?? null,
    forDate: r.for_date,
    destination: r.destination ?? null,
    reason: r.reason ?? null,
    status: r.status,
    reviewedAt: r.reviewed_at ?? null,
    reviewNote: r.review_note ?? null,
    createdAt: r.created_at
  }
}

/** FC: 직출 보고서 제출 (staff_id 는 DB default auth.uid()). */
export async function submitJikchulReport(input: {
  forDate: string
  destination?: string
  reason?: string
  staffName?: string
  teamId?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const c = await client()
  if (!c) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { error } = await c.from('jikchul_reports').insert({
    for_date: input.forDate,
    destination: input.destination?.trim() || null,
    reason: input.reason?.trim() || null,
    staff_name: input.staffName ?? null,
    team_id: input.teamId ?? null,
    status: 'pending'
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** 목록: 관리자=전체(RLS), FC=본인. forDate / status 로 필터. */
export async function listJikchulReports(opts?: { forDate?: string; status?: JikchulStatus }): Promise<{ ok: boolean; items: JikchulReport[]; error?: string }> {
  const c = await client()
  if (!c) return { ok: false, items: [] }
  let q = c
    .from('jikchul_reports')
    .select(JK_COLS)
    .order('for_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (opts?.forDate) q = q.eq('for_date', opts.forDate)
  if (opts?.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) return { ok: false, items: [], error: error.message }
  return { ok: true, items: ((data as any[]) ?? []).map(mapJk) }
}

/** 관리자: 승인/반려. */
export async function reviewJikchulReport(id: string, status: 'approved' | 'rejected', note?: string): Promise<{ ok: boolean; error?: string }> {
  const c = await client()
  if (!c) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { data: u } = await c.auth.getUser()
  const { error } = await c
    .from('jikchul_reports')
    .update({ status, reviewed_by: u?.user?.id ?? null, reviewed_at: new Date().toISOString(), review_note: note?.trim() || null })
    .eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** 특정 날짜에 '승인된 직출' staff_id 집합 — 로스터에서 '직출'(미출근 아님) 표시용. */
export async function listApprovedJikchulStaffIds(forDate: string): Promise<Set<string>> {
  const c = await client()
  if (!c) return new Set()
  const { data } = await c.from('jikchul_reports').select('staff_id').eq('for_date', forDate).eq('status', 'approved')
  return new Set(((data as any[]) ?? []).map((r) => r.staff_id).filter(Boolean) as string[])
}

// ── 잠시 멈춤 ──────────────────────────────────────────────────
export interface PausedStaff {
  staffId: string
  staffName: string | null
  pausedAt: string
}

export async function listPausedStaff(): Promise<{ ok: boolean; items: PausedStaff[] }> {
  const c = await client()
  if (!c) return { ok: false, items: [] }
  const { data, error } = await c.from('attendance_pauses').select('staff_id, staff_name, paused_at')
  if (error) return { ok: false, items: [] }
  return {
    ok: true,
    items: ((data as any[]) ?? []).map((r) => ({ staffId: r.staff_id, staffName: r.staff_name ?? null, pausedAt: r.paused_at }))
  }
}

/** 관리자: 멈춤(행 생성). */
export async function pauseStaff(staffId: string, staffName?: string): Promise<{ ok: boolean; error?: string }> {
  const c = await client()
  if (!c) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { error } = await c.from('attendance_pauses').upsert({ staff_id: staffId, staff_name: staffName ?? null }, { onConflict: 'staff_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** 관리자: 재개(행 삭제). */
export async function resumeStaff(staffId: string): Promise<{ ok: boolean; error?: string }> {
  const c = await client()
  if (!c) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { error } = await c.from('attendance_pauses').delete().eq('staff_id', staffId)
  return error ? { ok: false, error: error.message } : { ok: true }
}
