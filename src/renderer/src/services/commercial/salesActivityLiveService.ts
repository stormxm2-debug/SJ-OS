import { listScheduleEvents, type ScheduleDataMode, type ScheduleWithCustomer } from './scheduleService'
import { listOverviewStaff, type OverviewStaff } from './staffOverviewService'
import { SCHEDULE_TYPE_LABEL } from './scheduleValidation'
import type { ScheduleType } from './scheduleValidation'

/**
 * 영업활동 현황 (실데이터) — 회원(직원)들이 실제로 등록한 일정(schedule_events)을
 * 그대로 영업활동으로 집계한다. 일정 유형(AP·1·2·3차·클로징·증전…)이 곧 영업 단계다.
 *
 * - 관리자/대표: RLS가 전 직원 일정 SELECT를 허용하므로 모두의 활동이 자동 집계된다.
 * - FC 본인: RLS상 본인 일정만 → 본인 활동만 보인다(자연 스코프).
 * - 이름은 스케줄 어댑터가 비워서 오므로 프로필 로스터로 보강한다.
 * 읽기 전용. 개인일정(personal)·내부일정(internal)은 영업 지표에서 제외.
 */

/** 영업 지표에서 제외할 유형(개인/내부). */
const NON_SALES_TYPES = new Set<string>(['personal', 'internal'])

export interface LiveActivity extends ScheduleWithCustomer {
  staffName: string
  staffRole: string
  teamId: string | null
}

export interface ActivitySummary {
  total: number
  today: number
  thisWeek: number
  planned: number
  done: number
  cancelled: number
  /** 지난 날짜인데 아직 '예정'인(완료 처리 안 된) 활동 = 놓친 활동. */
  missed: number
  /** 오늘 등록된 AP 수(신규 접점). */
  apToday: number
  /** 완료율 = 완료 / (완료 + 놓친). 아직 안 지난 예정은 분모 제외. */
  completionRate: number
}

export interface StaffActivityRank {
  staffId: string
  name: string
  role: string
  total: number
  today: number
  done: number
  planned: number
  missed: number
  completionRate: number
}

export interface TypeBreakdownItem {
  type: string
  label: string
  count: number
}

export interface SalesActivityLive {
  ok: boolean
  mode: ScheduleDataMode
  events: LiveActivity[]
  staff: OverviewStaff[]
  error?: string
}

// ── 날짜 헬퍼 (로컬 기준) ───────────────────────────────────────────────
function startOfToday(): number {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
}
function endOfToday(): number {
  return startOfToday() + 24 * 60 * 60 * 1000
}
function startOfWeek(): number {
  const day = new Date().getDay() // 0=일
  return startOfToday() - ((day + 6) % 7) * 24 * 60 * 60 * 1000 // 월요일 시작
}

export function isSalesActivity(e: { type: string }): boolean {
  return !NON_SALES_TYPES.has(e.type)
}
export function isTodayActivity(e: { startsAt: string }): boolean {
  const t = Date.parse(e.startsAt)
  return !Number.isNaN(t) && t >= startOfToday() && t < endOfToday()
}
export function isMissed(e: { startsAt: string; status: string }): boolean {
  if (e.status !== 'planned') return false
  const t = Date.parse(e.startsAt)
  return !Number.isNaN(t) && t < startOfToday()
}

/**
 * 전 직원(또는 본인) 일정 + 프로필 로스터를 한 번에 로드해 영업활동으로 보강한다.
 */
export async function loadSalesActivityLive(): Promise<SalesActivityLive> {
  const [schedRes, staff] = await Promise.all([listScheduleEvents(), listOverviewStaff()])
  const roster = new Map(staff.map((s) => [s.id, s]))
  const events: LiveActivity[] = schedRes.events.map((e) => {
    const s = roster.get(e.staffId)
    return {
      ...e,
      staffName: s?.name || e.staffName || '(미지정)',
      staffRole: s?.role ?? 'fc',
      teamId: s?.teamId ?? null
    }
  })
  return { ok: schedRes.ok, mode: schedRes.mode, events, staff, error: schedRes.error }
}

/** 전체 요약(영업 유형만). */
export function summarize(events: LiveActivity[]): ActivitySummary {
  const sales = events.filter(isSalesActivity)
  const weekStart = startOfWeek()
  const tStart = startOfToday()
  let today = 0
  let thisWeek = 0
  let planned = 0
  let done = 0
  let cancelled = 0
  let missed = 0
  let apToday = 0
  for (const e of sales) {
    const t = Date.parse(e.startsAt)
    const inToday = !Number.isNaN(t) && t >= tStart && t < tStart + 86_400_000
    if (inToday) today += 1
    if (!Number.isNaN(t) && t >= weekStart && t < weekStart + 7 * 86_400_000) thisWeek += 1
    if (e.status === 'done') done += 1
    else if (e.status === 'cancelled') cancelled += 1
    else if (e.status === 'planned') {
      planned += 1
      if (!Number.isNaN(t) && t < tStart) missed += 1
    }
    if (e.type === 'ap' && inToday) apToday += 1
  }
  const resolved = done + missed
  const completionRate = resolved > 0 ? Math.round((done / resolved) * 100) : 0
  return { total: sales.length, today, thisWeek, planned, done, cancelled, missed, apToday, completionRate }
}

/** 회원(직원)별 활동 순위 — 활동이 1건 이상인 직원만, 완료·총량 순. */
export function rankByStaff(events: LiveActivity[]): StaffActivityRank[] {
  const sales = events.filter(isSalesActivity)
  const tStart = startOfToday()
  const by = new Map<string, StaffActivityRank>()
  for (const e of sales) {
    const cur =
      by.get(e.staffId) ??
      { staffId: e.staffId, name: e.staffName, role: e.staffRole, total: 0, today: 0, done: 0, planned: 0, missed: 0, completionRate: 0 }
    cur.total += 1
    const t = Date.parse(e.startsAt)
    if (!Number.isNaN(t) && t >= tStart && t < tStart + 86_400_000) cur.today += 1
    if (e.status === 'done') cur.done += 1
    else if (e.status === 'planned') {
      cur.planned += 1
      if (!Number.isNaN(t) && t < tStart) cur.missed += 1
    }
    by.set(e.staffId, cur)
  }
  const rows = [...by.values()].map((r) => {
    const resolved = r.done + r.missed
    return { ...r, completionRate: resolved > 0 ? Math.round((r.done / resolved) * 100) : 0 }
  })
  rows.sort((a, b) => b.done - a.done || b.total - a.total || a.name.localeCompare(b.name))
  return rows
}

/** 유형별 분포(영업 퍼널) — 등록 순서(SCHEDULE_TYPE_LABEL) 유지, 0건 제외. */
const FUNNEL_ORDER: ScheduleType[] = ['ap', 'meeting-1', 'meeting-2', 'meeting-3', 'closing', 'delivery', 'intro-meeting', 'meeting']
export function breakdownByType(events: LiveActivity[]): TypeBreakdownItem[] {
  const counts = new Map<string, number>()
  for (const e of events.filter(isSalesActivity)) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  const ordered: TypeBreakdownItem[] = []
  for (const t of FUNNEL_ORDER) {
    const c = counts.get(t) ?? 0
    if (c > 0) ordered.push({ type: t, label: SCHEDULE_TYPE_LABEL[t] ?? t, count: c })
    counts.delete(t)
  }
  // 순서표에 없는 나머지 유형(구버전 등)도 뒤에 붙인다.
  for (const [t, c] of counts) if (c > 0) ordered.push({ type: t, label: SCHEDULE_TYPE_LABEL[t as ScheduleType] ?? t, count: c })
  return ordered
}
