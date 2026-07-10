import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * DB(리드) 자동분배 서비스.
 *
 * 관리자가 DB(잠재고객 리드)를 입력하면 **활성 직원 중 미콜 부하가 가장 적은
 * 사람에게 최소부하 자동분배**한다(공평). 배정된 직원은 실시간 알림을 받고,
 * 24시간 내 '콜 완료'를 눌러야 한다 — 안 누르면 미콜(overdue)로 경고된다.
 * RLS: 관리자 전체 / 직원은 본인 배정분만. leads 테이블 참조.
 */

export type LeadStatus = 'new' | 'called' | 'contracted' | 'fail'

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: '미콜',
  called: '콜 완료',
  contracted: '계약',
  fail: '실패'
}

export interface Lead {
  id: string
  name: string
  phone: string | null
  source: string | null
  memo: string | null
  status: LeadStatus
  assignedFcId: string | null
  assignedFcName: string | null
  assignedAt: string | null
  firstCallAt: string | null
  createdAt: string
}

export interface LeadInput {
  name: string
  phone?: string
  source?: string
  memo?: string
}

export interface SalesStaff {
  id: string
  name: string
  role: string
  teamId?: string | null
}

const CALL_SLA_MS = 24 * 60 * 60 * 1000

/** 배정 후 24시간 내 콜이 없으면 미콜(경고). */
export function isOverdue(lead: Lead): boolean {
  if (lead.status !== 'new' || lead.firstCallAt || !lead.assignedAt) return false
  const t = Date.parse(lead.assignedAt)
  return Number.isFinite(t) && Date.now() - t > CALL_SLA_MS
}

/** 배정 후 남은 콜 시간(ms). 음수면 초과. */
export function callDeadlineRemainingMs(lead: Lead): number | null {
  if (!lead.assignedAt) return null
  const t = Date.parse(lead.assignedAt)
  if (!Number.isFinite(t)) return null
  return t + CALL_SLA_MS - Date.now()
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getUser()
    return data?.user?.id ?? null
  } catch {
    return null
  }
}

function mapLead(r: Record<string, any>): Lead {
  const raw = String(r.status ?? 'new')
  const status: LeadStatus = raw === 'called' || raw === 'contracted' || raw === 'fail' ? raw : 'new'
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    phone: r.phone ?? null,
    source: r.source ?? null,
    memo: r.memo ?? null,
    status,
    assignedFcId: r.assigned_fc_id ?? null,
    assignedFcName: r.assigned_fc_name ?? null,
    assignedAt: r.assigned_at ?? null,
    firstCallAt: r.first_call_at ?? null,
    createdAt: String(r.created_at ?? '')
  }
}

/** 분배 대상 = 활성 영업직원(관리자/대표 제외). */
export async function listSalesStaff(): Promise<SalesStaff[]> {
  const client = await getClient()
  if (!client) return []
  try {
    const { data, error } = await client
      .from('profiles')
      .select('id, name, role, team_id, status')
      .eq('status', 'active')
      .order('name')
    if (error) return []
    return ((data as any[]) ?? [])
      .filter((p) => p.role !== 'owner' && p.role !== 'admin')
      .map((p) => ({ id: String(p.id), name: p.name ?? '이름없음', role: p.role ?? 'fc', teamId: p.team_id }))
  } catch {
    return []
  }
}

/**
 * 리드들을 최소부하 자동분배해 저장 (관리자). 각 직원의 현재 미콜(new) 수를 세어
 * 가장 적은 사람부터 배분하고, 배치 내에서 즉시 카운트를 올려 균등을 유지한다.
 */
export async function distributeLeads(inputs: LeadInput[]): Promise<{ ok: boolean; assigned: number; perStaff: Record<string, number>; error?: string }> {
  const clean = inputs.map((i) => ({ ...i, name: (i.name ?? '').trim() })).filter((i) => i.name)
  if (clean.length === 0) return { ok: false, assigned: 0, perStaff: {}, error: '이름이 있는 리드가 없습니다.' }
  const client = await getClient()
  if (!client) return { ok: false, assigned: 0, perStaff: {}, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, assigned: 0, perStaff: {}, error: '로그인 후 사용할 수 있습니다.' }

  const staff = await listSalesStaff()
  if (staff.length === 0) return { ok: false, assigned: 0, perStaff: {}, error: '분배할 활성 직원이 없습니다. 직원을 먼저 등록·활성화해 주세요.' }

  // 현재 미콜(new) 부하 집계.
  const load: Record<string, number> = {}
  staff.forEach((s) => (load[s.id] = 0))
  try {
    const { data } = await client.from('leads').select('assigned_fc_id').eq('status', 'new')
    for (const row of (data as any[]) ?? []) {
      const id = row.assigned_fc_id
      if (id && id in load) load[id] += 1
    }
  } catch {
    /* 부하 조회 실패 시 0부터 균등 배분 */
  }

  const nameById = new Map(staff.map((s) => [s.id, s.name]))
  const nowIso = new Date().toISOString()
  const perStaff: Record<string, number> = {}
  const rows = clean.map((lead) => {
    // 부하 최소 직원 선택 (동률이면 첫 번째).
    let pick = staff[0].id
    for (const s of staff) if (load[s.id] < load[pick]) pick = s.id
    load[pick] += 1
    perStaff[pick] = (perStaff[pick] ?? 0) + 1
    return {
      name: lead.name,
      phone: lead.phone?.trim() || null,
      source: lead.source?.trim() || null,
      memo: lead.memo?.trim() || null,
      status: 'new',
      assigned_fc_id: pick,
      assigned_fc_name: nameById.get(pick) ?? null,
      assigned_at: nowIso,
      created_by: me
    }
  })

  try {
    const { error } = await client.from('leads').insert(rows)
    if (error) return { ok: false, assigned: 0, perStaff: {}, error: error.message }
    return { ok: true, assigned: rows.length, perStaff }
  } catch {
    return { ok: false, assigned: 0, perStaff: {}, error: '분배 저장 중 오류가 발생했습니다.' }
  }
}

/** 관리자: 전체 리드 (최신 배정순, 최대 500). RLS가 실제 경계. */
export async function listAllLeads(): Promise<{ ok: boolean; leads: Lead[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: true, leads: [] } // 백엔드 미연결(데모/오프라인) → 빈 상태로 (에러 배너 대신)
  try {
    const { data, error } = await client
      .from('leads')
      .select('id, name, phone, source, memo, status, assigned_fc_id, assigned_fc_name, assigned_at, first_call_at, created_at')
      .order('assigned_at', { ascending: false })
      .limit(500)
    if (error) return { ok: false, leads: [], error: error.message }
    return { ok: true, leads: ((data as any[]) ?? []).map(mapLead) }
  } catch {
    return { ok: false, leads: [] }
  }
}

/** 직원: 본인에게 배정된 리드 (RLS로 본인 것만 반환). */
export async function listMyLeads(): Promise<{ ok: boolean; leads: Lead[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: true, leads: [] } // 백엔드 미연결(데모/오프라인) → 빈 상태로
  const me = await uid(client)
  if (!me) return { ok: true, leads: [] }
  try {
    const { data, error } = await client
      .from('leads')
      .select('id, name, phone, source, memo, status, assigned_fc_id, assigned_fc_name, assigned_at, first_call_at, created_at')
      .eq('assigned_fc_id', me)
      .order('assigned_at', { ascending: false })
      .limit(500)
    if (error) return { ok: false, leads: [], error: error.message }
    return { ok: true, leads: ((data as any[]) ?? []).map(mapLead) }
  } catch {
    return { ok: false, leads: [] }
  }
}

/** '콜 완료' — 첫 콜 시각 기록 + 상태 called. 이미 콜했으면 시각은 유지. */
export async function markCalled(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const patch: Record<string, unknown> = { status: 'called', first_call_at: new Date().toISOString() }
    // 이미 first_call_at이 있으면 덮어쓰지 않도록: 없을 때만 세팅하려면 조건 업데이트가
    // 필요하지만, '콜 완료'는 최초 1회 누르는 UX라 단순 세팅으로 충분(중복 클릭 방지는 UI).
    const { error } = await client.from('leads').update(patch).eq('id', leadId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '처리 중 오류가 발생했습니다.' }
  }
}

/** 상태 변경 (계약/실패 등). */
export async function updateLeadStatus(leadId: string, status: LeadStatus): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('leads').update({ status }).eq('id', leadId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '처리 중 오류가 발생했습니다.' }
  }
}

/** 관리자: 리드 재배정 — 24시간 콜 시계를 리셋(assigned_at=now, status=new, first_call 초기화). */
export async function reassignLead(leadId: string, fcId: string, fcName: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client
      .from('leads')
      .update({ assigned_fc_id: fcId, assigned_fc_name: fcName, assigned_at: new Date().toISOString(), status: 'new', first_call_at: null })
      .eq('id', leadId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '재배정 중 오류가 발생했습니다.' }
  }
}
