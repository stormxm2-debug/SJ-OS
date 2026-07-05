import type {
  AttendanceRecord,
  ConsultationRecord,
  CustomerRecord,
  NoticeRecord,
  PerformanceRecord,
  ScheduleEvent,
  StaffUser
} from '@shared/commercial/models'
import { getSupabaseClientOrNull } from './supabaseClient'

/**
 * Supabase data adapters (skeletons).
 *
 * These match the existing service contracts but are DISABLED until Supabase is
 * configured (and `@supabase/supabase-js` installed). Every method returns a clear
 * not-configured result instead of silently failing or crashing — local-mock mode
 * remains the working path. No secrets, no service_role, no writes here yet.
 *
 * Future: when a client exists, replace each body with the mapped table query, e.g.
 *   const { data, error } = await client.from('customers').select('*')
 * and rely on RLS for per-row access control.
 */

export interface AdapterResult<T> {
  ok: boolean
  data?: T
  reason?: 'not-configured'
  message?: string
}

const NOT_CONFIGURED = 'Supabase가 구성되지 않았습니다. 현재 local-mock 모드입니다.'

function notConfigured<T>(): AdapterResult<T> {
  return { ok: false, reason: 'not-configured', message: NOT_CONFIGURED }
}

/** True when a usable Supabase client exists (currently always false). */
export function supabaseReady(): boolean {
  return getSupabaseClientOrNull() !== null
}

// --- auth ------------------------------------------------------------------
export const supabaseAuthAdapter = {
  // Future: client.auth.signInWithPassword(...) / getSession()
  signIn: async (): Promise<AdapterResult<StaffUser>> => notConfigured(),
  signOut: async (): Promise<AdapterResult<null>> => notConfigured(),
  me: async (): Promise<AdapterResult<StaffUser>> => notConfigured()
}

// --- staff -----------------------------------------------------------------
export const supabaseStaffAdapter = {
  listStaff: async (): Promise<AdapterResult<StaffUser[]>> => notConfigured(),
  getStaff: async (_id: string): Promise<AdapterResult<StaffUser>> => notConfigured(),
  createStaff: async (_s: StaffUser): Promise<AdapterResult<StaffUser>> => notConfigured(),
  updateStaff: async (_id: string, _p: Partial<StaffUser>): Promise<AdapterResult<StaffUser>> => notConfigured()
}

// --- attendance ------------------------------------------------------------
export const supabaseAttendanceAdapter = {
  listAttendance: async (): Promise<AdapterResult<AttendanceRecord[]>> => notConfigured(),
  createCheckIn: async (_r: AttendanceRecord): Promise<AdapterResult<AttendanceRecord>> => notConfigured(),
  createCheckOut: async (_r: AttendanceRecord): Promise<AdapterResult<AttendanceRecord>> => notConfigured()
}

// --- customers -------------------------------------------------------------
export const supabaseCustomerAdapter = {
  listCustomers: async (): Promise<AdapterResult<CustomerRecord[]>> => notConfigured(),
  createCustomer: async (_c: CustomerRecord): Promise<AdapterResult<CustomerRecord>> => notConfigured(),
  updateCustomer: async (_id: string, _p: Partial<CustomerRecord>): Promise<AdapterResult<CustomerRecord>> => notConfigured()
}

// --- consultations ---------------------------------------------------------
export const supabaseConsultationAdapter = {
  listConsultations: async (): Promise<AdapterResult<ConsultationRecord[]>> => notConfigured(),
  createConsultation: async (_c: ConsultationRecord): Promise<AdapterResult<ConsultationRecord>> => notConfigured(),
  updateConsultation: async (_id: string, _p: Partial<ConsultationRecord>): Promise<AdapterResult<ConsultationRecord>> => notConfigured()
}

// --- schedules -------------------------------------------------------------
export const supabaseScheduleAdapter = {
  listSchedules: async (): Promise<AdapterResult<ScheduleEvent[]>> => notConfigured(),
  createSchedule: async (_e: ScheduleEvent): Promise<AdapterResult<ScheduleEvent>> => notConfigured(),
  updateSchedule: async (_id: string, _p: Partial<ScheduleEvent>): Promise<AdapterResult<ScheduleEvent>> => notConfigured()
}

// --- performance -----------------------------------------------------------
export const supabasePerformanceAdapter = {
  listPerformance: async (): Promise<AdapterResult<PerformanceRecord[]>> => notConfigured(),
  createPerformance: async (_r: PerformanceRecord): Promise<AdapterResult<PerformanceRecord>> => notConfigured()
}

// --- notices ---------------------------------------------------------------
export const supabaseNoticeAdapter = {
  listNotices: async (): Promise<AdapterResult<NoticeRecord[]>> => notConfigured(),
  createNotice: async (_n: NoticeRecord): Promise<AdapterResult<NoticeRecord>> => notConfigured(),
  updateNotice: async (_id: string, _p: Partial<NoticeRecord>): Promise<AdapterResult<NoticeRecord>> => notConfigured()
}
