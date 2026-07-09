import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { SHORT_TERM_RATE } from './performanceRecordsService'

/**
 * 관리자 "직원 현황" 데이터 — 선택한 직원 한 명의 고객/일정/상담/실적/출퇴근을
 * 한 번에 모아 온다. RLS상 관리자(is_owner_or_admin)는 전 직원 데이터 열람이
 * 이미 허용되어 있으므로 직접 조회만 하면 된다. 읽기 전용.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OverviewStaff {
  id: string
  name: string
  role: string
  phone?: string
  teamId?: string | null
}

export interface StaffOverview {
  customerCount: number
  customers: { id: string; name: string; phone?: string; source?: string; createdAt: string }[]
  upcoming: { id: string; type: string; title?: string; customerName?: string; startsAt: string; status: string; location?: string }[]
  consultations: { id: string; type?: string; summary: string; customerName?: string; createdAt: string }[]
  perf: { life: number; nonLife: number; shortTerm: number; total: number; contractCount: number; source: 'excel' | 'self' | 'none' }
  attendance: { workDays: number; lateDays: number; lateFee: number; lastCheckIn?: string }
}

async function db(): Promise<any | null> {
  await initSupabaseClient()
  return getSupabaseClient() as any
}

// 정리표 → 직원현황 상세로 넘어갈 때 선택 직원을 전달하는 원샷 스토어
let overviewPrefill: string | null = null
export function setStaffOverviewPrefill(staffId: string): void {
  overviewPrefill = staffId
}
export function takeStaffOverviewPrefill(): string | null {
  const v = overviewPrefill
  overviewPrefill = null
  return v
}

/** 전 직원 정리표 한 행. */
export interface StaffTableRow {
  id: string
  name: string
  role: string
  customerCount: number
  life: number
  nonLife: number
  shortTerm: number
  total: number
  contractCount: number
  perfSource: 'excel' | 'self' | 'none'
  upcoming: number
  workDays: number
  lateDays: number
  lateFee: number
  lastCheckIn?: string
}

/**
 * 전 직원 정리표 — 관리자 화면용. 직원 수만큼 반복 조회하지 않고
 * 테이블당 1회 조회 후 클라이언트에서 집계한다 (18명 기준 6쿼리).
 */
export async function loadStaffTable(month: string): Promise<StaffTableRow[]> {
  const client = await db()
  if (!client) return []
  const { from, to } = monthRange(month)
  const nowIso = new Date().toISOString()

  const [profiles, customers, entries, excel, sched, att] = await Promise.all([
    client.from('profiles').select('id, name, role, status').eq('status', 'active').order('name'),
    client.from('customers').select('owner_staff_id'),
    client.from('performance_entries').select('staff_id, category, amount').eq('month', month),
    client.from('performance_records').select('staff_id, life_premium, non_life_premium, short_term_premium, contract_count').eq('month', month).eq('source', 'excel'),
    client.from('schedule_events').select('staff_id').eq('status', 'planned').gte('starts_at', nowIso),
    client.from('attendance_records').select('staff_id, status, late_fee, created_at').eq('type', 'check-in').gte('created_at', from).lt('created_at', to)
  ])

  const custBy = new Map<string, number>()
  for (const c of (customers?.data ?? []) as any[]) {
    if (c.owner_staff_id) custBy.set(c.owner_staff_id, (custBy.get(c.owner_staff_id) ?? 0) + 1)
  }
  const entryBy = new Map<string, { life: number; nonLife: number; shortTerm: number; n: number }>()
  for (const e of (entries?.data ?? []) as any[]) {
    const cur = entryBy.get(e.staff_id) ?? { life: 0, nonLife: 0, shortTerm: 0, n: 0 }
    const amt = Number(e.amount ?? 0)
    if (e.category === 'life') cur.life += amt
    else if (e.category === 'non-life') cur.nonLife += amt
    else if (e.category === 'short-term') cur.shortTerm += amt
    cur.n += 1
    entryBy.set(e.staff_id, cur)
  }
  const excelBy = new Map<string, any>()
  for (const x of (excel?.data ?? []) as any[]) excelBy.set(x.staff_id, x)
  const schedBy = new Map<string, number>()
  for (const s of (sched?.data ?? []) as any[]) schedBy.set(s.staff_id, (schedBy.get(s.staff_id) ?? 0) + 1)
  const attBy = new Map<string, { work: number; late: number; fee: number; last?: string }>()
  for (const a of (att?.data ?? []) as any[]) {
    const cur = attBy.get(a.staff_id) ?? { work: 0, late: 0, fee: 0, last: undefined }
    cur.work += 1
    if (a.status === 'late') {
      cur.late += 1
      cur.fee += Number(a.late_fee ?? 0)
    }
    if (!cur.last || a.created_at > cur.last) cur.last = a.created_at
    attBy.set(a.staff_id, cur)
  }

  const rows: StaffTableRow[] = ((profiles?.data ?? []) as any[]).map((p) => {
    const x = excelBy.get(p.id)
    const e = entryBy.get(p.id)
    let life = 0
    let nonLife = 0
    let shortTerm = 0
    let contractCount = 0
    let perfSource: StaffTableRow['perfSource'] = 'none'
    if (x) {
      life = Number(x.life_premium ?? 0)
      nonLife = Number(x.non_life_premium ?? 0)
      shortTerm = Number(x.short_term_premium ?? 0)
      contractCount = Number(x.contract_count ?? 0)
      perfSource = 'excel'
    } else if (e) {
      life = e.life
      nonLife = e.nonLife
      shortTerm = e.shortTerm
      contractCount = e.n
      perfSource = 'self'
    }
    const a = attBy.get(p.id)
    return {
      id: p.id,
      name: p.name ?? '이름없음',
      role: p.role ?? 'fc',
      customerCount: custBy.get(p.id) ?? 0,
      life,
      nonLife,
      shortTerm,
      total: Math.round(life + nonLife + shortTerm * SHORT_TERM_RATE),
      contractCount,
      perfSource,
      upcoming: schedBy.get(p.id) ?? 0,
      workDays: a?.work ?? 0,
      lateDays: a?.late ?? 0,
      lateFee: a?.fee ?? 0,
      lastCheckIn: a?.last
    }
  })
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return rows
}

/** 활성 직원 목록 (이름순). */
export async function listOverviewStaff(): Promise<OverviewStaff[]> {
  const client = await db()
  if (!client) return []
  const { data, error } = await client
    .from('profiles')
    .select('id, name, role, phone, team_id, status')
    .eq('status', 'active')
    .order('name', { ascending: true })
  if (error || !Array.isArray(data)) return []
  return (data as any[]).map((p) => ({ id: p.id, name: p.name ?? '이름없음', role: p.role ?? 'fc', phone: p.phone ?? undefined, teamId: p.team_id }))
}

/** 이번 달 경계(로컬) → ISO. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** 선택 직원의 현황 전체 로드 (병렬). month = 'YYYY-MM'. */
export async function loadStaffOverview(staffId: string, month: string): Promise<StaffOverview | null> {
  const client = await db()
  if (!client) return null
  const { from, to } = monthRange(month)
  const nowIso = new Date().toISOString()

  const [cust, sched, consult, entries, excel, att] = await Promise.all([
    client
      .from('customers')
      .select('id, name, phone, source, created_at', { count: 'exact' })
      .eq('owner_staff_id', staffId)
      .order('created_at', { ascending: false })
      .limit(30),
    client
      .from('schedule_events')
      .select('id, type, title, manual_customer_name, starts_at, status, location, customers(name)')
      .eq('staff_id', staffId)
      .gte('starts_at', nowIso)
      .order('starts_at', { ascending: true })
      .limit(15),
    client
      .from('consultations')
      .select('id, consultation_type, summary, created_at, customers(name)')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false })
      .limit(15),
    client.from('performance_entries').select('category, amount').eq('staff_id', staffId).eq('month', month),
    client.from('performance_records').select('life_premium, non_life_premium, short_term_premium, contract_count, source').eq('staff_id', staffId).eq('month', month).eq('source', 'excel').maybeSingle(),
    client.from('attendance_records').select('type, status, late_fee, created_at').eq('staff_id', staffId).eq('type', 'check-in').gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false })
  ])

  // 실적: 관리자 엑셀 우선, 없으면 본인 건별 입력 집계
  let life = 0
  let nonLife = 0
  let shortTerm = 0
  let contractCount = 0
  let source: 'excel' | 'self' | 'none' = 'none'
  if (excel?.data) {
    life = Number(excel.data.life_premium ?? 0)
    nonLife = Number(excel.data.non_life_premium ?? 0)
    shortTerm = Number(excel.data.short_term_premium ?? 0)
    contractCount = Number(excel.data.contract_count ?? 0)
    source = 'excel'
  } else if (Array.isArray(entries?.data) && entries.data.length > 0) {
    for (const e of entries.data as any[]) {
      const amt = Number(e.amount ?? 0)
      if (e.category === 'life') life += amt
      else if (e.category === 'non-life') nonLife += amt
      else if (e.category === 'short-term') shortTerm += amt
    }
    contractCount = entries.data.length
    source = 'self'
  }
  const total = Math.round(life + nonLife + shortTerm * SHORT_TERM_RATE)

  const attRows = Array.isArray(att?.data) ? (att.data as any[]) : []
  const lateRows = attRows.filter((a) => a.status === 'late')

  return {
    customerCount: cust?.count ?? (Array.isArray(cust?.data) ? cust.data.length : 0),
    customers: (Array.isArray(cust?.data) ? (cust.data as any[]) : []).map((c) => ({
      id: c.id,
      name: c.name ?? '',
      phone: c.phone ?? undefined,
      source: c.source ?? undefined,
      createdAt: c.created_at
    })),
    upcoming: (Array.isArray(sched?.data) ? (sched.data as any[]) : []).map((s) => ({
      id: s.id,
      type: s.type ?? 'meeting',
      title: s.title ?? undefined,
      customerName: s.customers?.name ?? s.manual_customer_name ?? undefined,
      startsAt: s.starts_at,
      status: s.status ?? 'planned',
      location: s.location ?? undefined
    })),
    consultations: (Array.isArray(consult?.data) ? (consult.data as any[]) : []).map((c) => ({
      id: c.id,
      type: c.consultation_type ?? undefined,
      summary: c.summary ?? '',
      customerName: c.customers?.name ?? undefined,
      createdAt: c.created_at
    })),
    perf: { life, nonLife, shortTerm, total, contractCount, source },
    attendance: {
      workDays: attRows.length,
      lateDays: lateRows.length,
      lateFee: lateRows.reduce((s, a) => s + Number(a.late_fee ?? 0), 0),
      lastCheckIn: attRows[0]?.created_at
    }
  }
}
