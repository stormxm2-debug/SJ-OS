import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { getBackendConfig } from './backendConfig'
import { loadStaffTable, type StaffTableRow } from './staffOverviewService'
import { listScheduleEvents, filterToday, type ScheduleWithCustomer } from './scheduleService'
import { listAllLeads, isOverdue, type Lead } from './leadService'

/**
 * CEO 관제 센터 실데이터 — 회사 전체 스냅샷을 Supabase에서 한 번에 모은다.
 * 기존 로컬 목업(@shared/company)을 대체. 관리자/대표는 RLS상 전 직원 데이터 열람이
 * 허용되므로 그대로 집계된다. 직원현황(staffTable)·일정·리드·고객·고객등록을 재활용.
 * 읽기 전용.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ControlMode = 'supabase' | 'local' | 'no-session'

export interface RecentCustomer {
  id: string
  name: string
  phone?: string
  source?: string
  createdAt: string
}

export interface CompanyControlSummary {
  staffCount: number
  checkedInToday: number
  monthlyRevenue: number
  todayScheduleCount: number
  newCustomersThisMonth: number
  uncalledLeads: number
  overdueLeads: number
  pendingRegistrations: number
}

export interface CompanyControlSnapshot {
  ok: boolean
  mode: ControlMode
  summary: CompanyControlSummary
  staff: StaffTableRow[]
  todaySchedule: ScheduleWithCustomer[]
  recentCustomers: RecentCustomer[]
  error?: string
}

const EMPTY_SUMMARY: CompanyControlSummary = {
  staffCount: 0,
  checkedInToday: 0,
  monthlyRevenue: 0,
  todayScheduleCount: 0,
  newCustomersThisMonth: 0,
  uncalledLeads: 0,
  overdueLeads: 0,
  pendingRegistrations: 0
}

function emptySnapshot(mode: ControlMode, error?: string): CompanyControlSnapshot {
  return { ok: mode !== 'no-session', mode, summary: { ...EMPTY_SUMMARY }, staff: [], todaySchedule: [], recentCustomers: [], error }
}

/** 회사 관제 스냅샷 로드 (관리자 전용 화면 — RLS가 전 직원 집계를 허용). */
export async function loadCompanyControl(): Promise<CompanyControlSnapshot> {
  if (getBackendConfig().mode !== 'supabase') return emptySnapshot('local')
  await initSupabaseClient()
  const client = getSupabaseClient() as any
  if (!client) return emptySnapshot('no-session', '로그인 후 표시됩니다.')

  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEndIso = new Date(todayStart.getTime() + 86_400_000).toISOString()
  const todayStartIso = todayStart.toISOString()
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  try {
    const [staff, schedRes, leadsRes, recentCustRes, newCustRes, regRes, checkinRes] = await Promise.all([
      loadStaffTable(month),
      listScheduleEvents(),
      listAllLeads(),
      client.from('customers').select('id, name, phone, source, created_at').order('created_at', { ascending: false }).limit(8),
      client.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', monthStartIso),
      client.from('customer_registrations').select('id', { count: 'exact', head: true }).eq('status', 'requested'),
      client.from('attendance_records').select('staff_id').eq('type', 'check-in').gte('created_at', todayStartIso).lt('created_at', todayEndIso)
    ])

    const todaySchedule = filterToday(schedRes.events ?? [])
    const leads: Lead[] = leadsRes.leads ?? []
    const uncalledLeads = leads.filter((l) => l.status === 'new').length
    const overdueLeads = leads.filter(isOverdue).length

    // 오늘 출근 = 오늘 체크인한 서로 다른 직원 수
    const checkedInSet = new Set<string>()
    for (const r of (checkinRes?.data as any[]) ?? []) if (r.staff_id) checkedInSet.add(String(r.staff_id))

    const monthlyRevenue = staff.reduce((sum, s) => sum + (s.total ?? 0), 0)

    const recentCustomers: RecentCustomer[] = ((recentCustRes?.data as any[]) ?? []).map((c) => ({
      id: String(c.id),
      name: c.name ?? '',
      phone: c.phone ?? undefined,
      source: c.source ?? undefined,
      createdAt: String(c.created_at ?? '')
    }))

    return {
      ok: true,
      mode: 'supabase',
      summary: {
        staffCount: staff.length,
        checkedInToday: checkedInSet.size,
        monthlyRevenue,
        todayScheduleCount: todaySchedule.length,
        newCustomersThisMonth: newCustRes?.count ?? 0,
        uncalledLeads,
        overdueLeads,
        pendingRegistrations: regRes?.count ?? 0
      },
      staff,
      todaySchedule,
      recentCustomers
    }
  } catch {
    return emptySnapshot('supabase', '관제 데이터를 불러오지 못했습니다.')
  }
}
