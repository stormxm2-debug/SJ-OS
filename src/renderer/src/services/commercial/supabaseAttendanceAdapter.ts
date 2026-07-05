import type { AttendanceRecord } from '@shared/commercial/models'
import type { AttendanceInput } from './attendanceValidation'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase attendance adapter — real queries against public.attendance_records.
 *
 * SECURITY: anon public client only (never service_role). RLS is the real access
 * boundary; client-side filtering is UX only. Never logs photo_path/photo data or
 * PII. staff_id is set to the auth user id on insert and is never client-settable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT_COLS =
  'id, staff_id, type, status, timestamp, photo_path, watermark_text, memo, created_at, staff:profiles(id, name, role, team_id)'

export type AdapterReason = 'not-configured' | 'no-session' | 'error'
export interface AdapterOk<T> {
  ok: true
  data: T
}
export interface AdapterErr {
  ok: false
  reason: AdapterReason
  message: string
}
export type AdapterResult<T> = AdapterOk<T> | AdapterErr

function err(reason: AdapterReason, message: string): AdapterErr {
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

export interface AttendanceWithStaff extends AttendanceRecord {
  teamId?: string
}

function mapRow(row: Record<string, unknown>): AttendanceWithStaff {
  const staff = (row.staff as Record<string, unknown> | null) ?? null
  return {
    id: String(row.id),
    staffId: String(row.staff_id ?? ''),
    staffName: staff ? String(staff.name ?? '') : '',
    type: (row.type as AttendanceRecord['type']) ?? 'check-in',
    status: (row.status as AttendanceRecord['status']) ?? 'normal',
    timestamp: String(row.timestamp ?? ''),
    photoUrl: undefined, // never expose raw photo data; only photo_path is stored
    watermarkText: (row.watermark_text as string | null) ?? undefined,
    memo: (row.memo as string | null) ?? undefined,
    teamId: staff ? ((staff.team_id as string | null) ?? undefined) : undefined
  }
}

function todayRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

function buildInsert(input: AttendanceInput, staffId: string): Record<string, unknown> {
  return {
    staff_id: staffId, // must equal auth.uid() (RLS enforces)
    type: input.type,
    status: input.status,
    timestamp: input.timestamp,
    photo_path: input.photoPath?.trim() || null,
    watermark_text: input.watermarkText?.trim() || null,
    memo: input.memo?.trim() || null
  }
}

export const supabaseAttendanceAdapter = {
  async listAttendanceRecords(): Promise<AdapterResult<AttendanceWithStaff[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('attendance_records').select(SELECT_COLS).order('timestamp', { ascending: false })
    if (error) return err('error', '출퇴근 기록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async listTodayAttendanceRecords(): Promise<AdapterResult<AttendanceWithStaff[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { start, end } = todayRange()
    const { data, error } = await client
      .from('attendance_records')
      .select(SELECT_COLS)
      .gte('timestamp', start)
      .lt('timestamp', end)
      .order('timestamp', { ascending: false })
    if (error) return err('error', '출퇴근 기록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async listMyTodayAttendance(): Promise<AdapterResult<AttendanceWithStaff[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { start, end } = todayRange()
    const { data, error } = await client
      .from('attendance_records')
      .select(SELECT_COLS)
      .eq('staff_id', userId)
      .gte('timestamp', start)
      .lt('timestamp', end)
      .order('timestamp', { ascending: false })
    if (error) return err('error', '출퇴근 기록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async createCheckIn(input: AttendanceInput): Promise<AdapterResult<AttendanceWithStaff>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('attendance_records').insert(buildInsert({ ...input, type: 'check-in' }, userId)).select(SELECT_COLS).single()
    if (error) return err('error', '출근 기록 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async createCheckOut(input: AttendanceInput): Promise<AdapterResult<AttendanceWithStaff>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('attendance_records').insert(buildInsert({ ...input, type: 'check-out' }, userId)).select(SELECT_COLS).single()
    if (error) return err('error', '퇴근 기록 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  }
}
