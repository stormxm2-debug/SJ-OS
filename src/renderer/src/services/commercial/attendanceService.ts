import type { AttendanceRecord } from '@shared/commercial/models'
import type { AttendanceInput } from './attendanceValidation'
import { getBackendConfig } from './backendConfig'
import { attendanceRepository } from './services'
import { supabaseAttendanceAdapter, type AttendanceWithStaff } from './supabaseAttendanceAdapter'

/**
 * Unified attendance service. Routes to Supabase when configured + logged in, else
 * to the local-mock repository. Callers get a data-mode tag + Korean error and never
 * see raw SQL/tokens/photo data. Summaries/today filters are client-side UX (RLS is
 * authoritative).
 */

export type AttendanceDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface AttendanceListResult {
  ok: boolean
  mode: AttendanceDataMode
  records: AttendanceWithStaff[]
  error?: string
}
export interface AttendanceMutationResult {
  ok: boolean
  mode: AttendanceDataMode
  record?: AttendanceWithStaff
  error?: string
}
export interface AttendanceSummary {
  total: number
  checkedIn: number
  notCheckedIn: number
  late: number
  checkedOut: number
  earlyLeave: number
  missing: number
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}
function isToday(iso: string): boolean {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  const d = new Date(t)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}
function toWithStaff(r: AttendanceRecord): AttendanceWithStaff {
  return { ...r }
}

export async function listAttendanceRecords(): Promise<AttendanceListResult> {
  if (isSupabase()) {
    const res = await supabaseAttendanceAdapter.listAttendanceRecords()
    if (res.ok) return { ok: true, mode: 'supabase', records: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : res.reason === 'not-configured' ? 'not-configured' : 'supabase', records: [], error: res.message }
  }
  const items = await attendanceRepository.list()
  return { ok: true, mode: 'local-mock', records: items.map(toWithStaff) }
}

export async function listMyTodayAttendance(): Promise<AttendanceListResult> {
  if (isSupabase()) {
    const res = await supabaseAttendanceAdapter.listMyTodayAttendance()
    if (res.ok) return { ok: true, mode: 'supabase', records: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', records: [], error: res.message }
  }
  const items = await attendanceRepository.list()
  return { ok: true, mode: 'local-mock', records: items.filter((r) => isToday(r.timestamp)).map(toWithStaff) }
}

async function saveLocal(input: AttendanceInput, type: AttendanceRecord['type']): Promise<AttendanceMutationResult> {
  const record: AttendanceRecord = {
    id: `a-local-${new Date().toISOString()}-${Math.floor(Math.random() * 1000)}`,
    staffId: 'local',
    staffName: '로컬 사용자',
    type,
    status: input.status,
    timestamp: input.timestamp,
    watermarkText: input.watermarkText?.trim() || undefined,
    memo: input.memo?.trim() || undefined
  }
  const saved = await attendanceRepository.create(record)
  return { ok: true, mode: 'local-mock', record: toWithStaff(saved) }
}

export async function createCheckIn(input: AttendanceInput): Promise<AttendanceMutationResult> {
  if (isSupabase()) {
    const res = await supabaseAttendanceAdapter.createCheckIn(input)
    if (res.ok) return { ok: true, mode: 'supabase', record: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', error: res.message }
  }
  return saveLocal(input, 'check-in')
}
export async function createCheckOut(input: AttendanceInput): Promise<AttendanceMutationResult> {
  if (isSupabase()) {
    const res = await supabaseAttendanceAdapter.createCheckOut(input)
    if (res.ok) return { ok: true, mode: 'supabase', record: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', error: res.message }
  }
  return saveLocal(input, 'check-out')
}

export interface WorkedDuration {
  /** True once a check-in exists for today. */
  started: boolean
  /** True once a check-out exists for today (duration is final). */
  ended: boolean
  /** Elapsed minutes from first check-in to last check-out (or now if still working). */
  minutes: number
  /** Korean label e.g. "3시간 20분", or "-" when not started. */
  label: string
}

/**
 * Compute today's worked duration for a single person's records (already RLS-scoped
 * to the current user via listMyTodayAttendance). Uses the earliest check-in and the
 * latest check-out; if not yet checked out, measures up to `now`. Client-side UX only.
 */
export function getTodayWorkedDuration(myTodayRecords: AttendanceWithStaff[], now: Date = new Date()): WorkedDuration {
  const today = myTodayRecords.filter((r) => isToday(r.timestamp))
  const checkInTimes = today.filter((r) => r.type === 'check-in').map((r) => Date.parse(r.timestamp)).filter((t) => !Number.isNaN(t))
  const checkOutTimes = today.filter((r) => r.type === 'check-out').map((r) => Date.parse(r.timestamp)).filter((t) => !Number.isNaN(t))
  if (checkInTimes.length === 0) return { started: false, ended: false, minutes: 0, label: '-' }
  const start = Math.min(...checkInTimes)
  const ended = checkOutTimes.length > 0
  const end = ended ? Math.max(...checkOutTimes) : now.getTime()
  const minutes = Math.max(0, Math.round((end - start) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const label = h > 0 ? `${h}시간 ${m}분` : `${m}분`
  return { started: true, ended, minutes, label }
}

/** Team/owner summary computed from today's visible (RLS-scoped) records. */
export function getAttendanceSummary(records: AttendanceWithStaff[]): AttendanceSummary {
  const today = records.filter((r) => isToday(r.timestamp))
  const checkIns = today.filter((r) => r.type === 'check-in')
  const checkOuts = today.filter((r) => r.type === 'check-out')
  const distinct = (rs: AttendanceWithStaff[]): number => new Set(rs.map((r) => r.staffId)).size
  const total = distinct(today)
  const checkedIn = distinct(checkIns)
  return {
    total,
    checkedIn,
    notCheckedIn: Math.max(0, total - checkedIn),
    late: checkIns.filter((r) => r.status === 'late').length,
    checkedOut: distinct(checkOuts),
    earlyLeave: checkOuts.filter((r) => r.status === 'early-leave').length,
    missing: today.filter((r) => r.status === 'missing').length
  }
}

export type { AttendanceWithStaff }
