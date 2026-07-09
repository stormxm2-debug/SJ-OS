import type { AttendanceRecord } from '@shared/commercial/models'
import type { AttendanceInput } from './attendanceValidation'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { uploadAttendancePhoto, createSignedPhotoUrls, isAttendancePhotoStorageConfigured } from './attendancePhotoStorage'

/**
 * Supabase attendance adapter — real queries against public.attendance_records.
 *
 * SECURITY: anon public client only (never service_role). RLS is the real access
 * boundary; client-side filtering is UX only. Never logs photo_path/photo data or
 * PII. staff_id is set to the auth user id on insert and is never client-settable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT_COLS =
  'id, staff_id, type, status, timestamp, photo_path, watermark_text, memo, late_fee, address, created_at, staff:profiles(id, name, role, team_id)'

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
    lateFee: row.late_fee != null ? Number(row.late_fee) : 0,
    address: (row.address as string | null) ?? undefined,
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
    memo: input.memo?.trim() || null,
    late_fee: input.lateFee ?? 0,
    address: input.address?.trim() || null
  }
}

/**
 * Upload the inline camera photo (data URL) to private Storage and return the storage
 * PATH for photo_path (never the bytes). Falls back to any explicit photoPath, else
 * undefined. Upload failures degrade gracefully to "record without photo".
 */
async function resolvePhotoPath(client: any, userId: string, input: AttendanceInput): Promise<string | undefined> {
  const dataUrl = input.photoDataUrl?.trim()
  if (dataUrl && isAttendancePhotoStorageConfigured()) {
    const res = await uploadAttendancePhoto(client, userId, dataUrl)
    if (res.ok && res.path) return res.path
  }
  return input.photoPath?.trim() || undefined
}

/** Attach RLS-scoped signed URLs (photoUrl) for rows that carry a photo_path. */
async function attachSignedUrls(client: any, rows: any[], mapped: AttendanceWithStaff[]): Promise<AttendanceWithStaff[]> {
  const paths = rows.map((r) => (r?.photo_path ? String(r.photo_path) : '')).filter(Boolean)
  if (paths.length === 0) return mapped
  const urls = await createSignedPhotoUrls(client, paths)
  mapped.forEach((rec, i) => {
    const path = rows[i]?.photo_path ? String(rows[i].photo_path) : ''
    if (path) {
      const url = urls.get(path)
      if (url) rec.photoUrl = url
    }
  })
  return mapped
}

export const supabaseAttendanceAdapter = {
  /** GPS 주소 백그라운드 채움 (본인 기록만 — RLS 강제). 촬영/기록을 지연시키지 않기 위해 저장 후 호출된다. */
  async updateAddress(recordId: string, address: string): Promise<AdapterResult<void>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    try {
      const { error } = await client
        .from('attendance_records')
        .update({ address: address.trim() || null })
        .eq('id', recordId)
      if (error) return err('error', '주소 저장에 실패했습니다.')
      return { ok: true, data: undefined }
    } catch {
      return err('error', '주소 저장에 실패했습니다.')
    }
  },

  /** 오늘의 다짐 저장 (본인 기록만 — RLS 강제). 출근 후 잠금 해제용. */
  async updateResolution(recordId: string, memo: string): Promise<AdapterResult<void>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    try {
      const { error } = await client
        .from('attendance_records')
        .update({ memo: memo.trim() || null })
        .eq('id', recordId)
      if (error) return err('error', '다짐 저장에 실패했습니다.')
      return { ok: true, data: undefined }
    } catch {
      return err('error', '다짐 저장에 실패했습니다.')
    }
  },

  async listAttendanceRecords(): Promise<AdapterResult<AttendanceWithStaff[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('attendance_records').select(SELECT_COLS).order('timestamp', { ascending: false })
    if (error) return err('error', '출퇴근 기록을 불러오지 못했습니다.')
    const rows = data ?? []
    return { ok: true, data: await attachSignedUrls(client, rows, rows.map(mapRow)) }
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
    const rows = data ?? []
    return { ok: true, data: await attachSignedUrls(client, rows, rows.map(mapRow)) }
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
    const rows = data ?? []
    return { ok: true, data: await attachSignedUrls(client, rows, rows.map(mapRow)) }
  },

  async createCheckIn(input: AttendanceInput): Promise<AdapterResult<AttendanceWithStaff>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const photoPath = await resolvePhotoPath(client, userId, input)
    const { data, error } = await client.from('attendance_records').insert(buildInsert({ ...input, type: 'check-in', photoPath }, userId)).select(SELECT_COLS).single()
    if (error) return err('error', '출근 기록 저장에 실패했습니다.')
    const [rec] = await attachSignedUrls(client, [data], [mapRow(data)])
    return { ok: true, data: rec }
  },

  async createCheckOut(input: AttendanceInput): Promise<AdapterResult<AttendanceWithStaff>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const photoPath = await resolvePhotoPath(client, userId, input)
    const { data, error } = await client.from('attendance_records').insert(buildInsert({ ...input, type: 'check-out', photoPath }, userId)).select(SELECT_COLS).single()
    if (error) return err('error', '퇴근 기록 저장에 실패했습니다.')
    const [rec] = await attachSignedUrls(client, [data], [mapRow(data)])
    return { ok: true, data: rec }
  }
}
