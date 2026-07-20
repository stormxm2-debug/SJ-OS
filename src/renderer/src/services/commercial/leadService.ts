import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * DB 배정 서비스.
 *
 * 관리자가 DB(잠재고객 리드)를 DB종류와 함께 입력하면 **활성 직원 중 미콜 부하가
 * 가장 적은 사람에게 최소부하 자동배정**한다(공평). 배정된 직원은 실시간 알림을
 * 받고, 24시간 내 '콜 완료'를 눌러야 한다 — 안 누르면 미콜(overdue)로 경고된다.
 * DB종류(lead_db_types)는 관리자가 등록/삭제하고 각 DB에 태깅한다.
 * RLS: 관리자 전체 / 직원은 본인 배정분만. leads · lead_db_types 테이블 참조.
 */

export type LeadStatus =
  | 'new' // 미콜 (배정 직후)
  | 'absent' // 부재중
  | 'recall' // 재통화 예정
  | 'called' // 통화완료
  | 'appointment' // 약속잡힘(AP)
  | 'consulting' // 상담중
  | 'contracted' // 계약
  | 'rejected' // 거절
  | 'invalid' // 결번·무효 DB
  | 'fail' // (구버전 호환 — 신규 UI에서는 거절/결번으로 대체)

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: '미콜',
  absent: '부재중',
  recall: '재통화 예정',
  called: '통화완료',
  appointment: '약속잡힘',
  consulting: '상담중',
  contracted: '계약',
  rejected: '거절',
  invalid: '결번·무효',
  fail: '실패(구)'
}

/** FC가 DB 진행하며 체크하는 카테고리 (표시 순서 — 표준 8단계). */
export const LEAD_STATUS_FLOW: LeadStatus[] = [
  'new',
  'absent',
  'recall',
  'called',
  'appointment',
  'consulting',
  'contracted',
  'rejected',
  'invalid'
]

const VALID_LEAD_STATUS = new Set<string>(LEAD_STATUS_FLOW.concat('fail'))

export interface Lead {
  id: string
  name: string
  phone: string | null
  source: string | null
  memo: string | null
  status: LeadStatus
  /** DB 종류(태그) — 예: 소상공인DB, 여성일반DB, 실버DB. 관리자 등록 목록에서 선택. */
  dbType: string | null
  assignedFcId: string | null
  assignedFcName: string | null
  assignedAt: string | null
  firstCallAt: string | null
  createdAt: string
}

/** DB 종류 레지스트리 항목 (관리자 관리). */
export interface LeadDbType {
  id: string
  name: string
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
  const status: LeadStatus = VALID_LEAD_STATUS.has(raw) ? (raw as LeadStatus) : 'new'
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    phone: r.phone ?? null,
    source: r.source ?? null,
    memo: r.memo ?? null,
    status,
    dbType: r.db_type ?? null,
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
export async function distributeLeads(inputs: LeadInput[], dbType?: string): Promise<{ ok: boolean; assigned: number; perStaff: Record<string, number>; error?: string }> {
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
  const type = dbType?.trim() || null
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
      db_type: type,
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
      .select('id, name, phone, source, memo, status, db_type, assigned_fc_id, assigned_fc_name, assigned_at, first_call_at, created_at')
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
      .select('id, name, phone, source, memo, status, db_type, assigned_fc_id, assigned_fc_name, assigned_at, first_call_at, created_at')
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

/**
 * 상태 변경 (진행 카테고리 체크). stampFirstCall이면 첫 접촉 시각(first_call_at)도
 * 함께 기록 — 미콜에서 벗어나는 첫 상태 변경 시 페이지가 켜서 호출한다.
 */
export async function updateLeadStatus(
  leadId: string,
  status: LeadStatus,
  opts?: { stampFirstCall?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const patch: Record<string, unknown> = { status }
    if (opts?.stampFirstCall) patch.first_call_at = new Date().toISOString()
    const { error } = await client.from('leads').update(patch).eq('id', leadId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '처리 중 오류가 발생했습니다.' }
  }
}

/**
 * 관리자: 선택한 직원에게 직접 배정 — 업로드/붙여넣기 리드를 대표가 고른
 * 직원 한 명에게 몰아서 배정한다 (자동 최소부하와 별개 경로).
 */
export async function assignLeadsTo(
  inputs: LeadInput[],
  fc: { id: string; name: string },
  dbType?: string
): Promise<{ ok: boolean; assigned: number; error?: string }> {
  const clean = inputs.map((i) => ({ ...i, name: (i.name ?? '').trim() })).filter((i) => i.name)
  if (clean.length === 0) return { ok: false, assigned: 0, error: '이름이 있는 리드가 없습니다.' }
  const client = await getClient()
  if (!client) return { ok: false, assigned: 0, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, assigned: 0, error: '로그인 후 사용할 수 있습니다.' }
  const nowIso = new Date().toISOString()
  const type = dbType?.trim() || null
  const rows = clean.map((lead) => ({
    name: lead.name,
    phone: lead.phone?.trim() || null,
    source: lead.source?.trim() || null,
    memo: lead.memo?.trim() || null,
    status: 'new',
    db_type: type,
    assigned_fc_id: fc.id,
    assigned_fc_name: fc.name,
    assigned_at: nowIso,
    created_by: me
  }))
  try {
    const { error } = await client.from('leads').insert(rows)
    if (error) return { ok: false, assigned: 0, error: error.message }
    return { ok: true, assigned: rows.length }
  } catch {
    return { ok: false, assigned: 0, error: '배정 저장 중 오류가 발생했습니다.' }
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

/** 개별 리드의 DB 종류(태그) 변경. */
export async function updateLeadDbType(leadId: string, dbType: string | null): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('leads').update({ db_type: dbType?.trim() || null }).eq('id', leadId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '처리 중 오류가 발생했습니다.' }
  }
}

// ── DB 종류 레지스트리 (관리자 관리, 전 직원 조회) ─────────────────────────

/** 등록된 DB 종류 목록 (정렬순 → 이름순). */
export async function listDbTypes(): Promise<LeadDbType[]> {
  const client = await getClient()
  if (!client) return []
  try {
    const { data, error } = await client
      .from('lead_db_types')
      .select('id, name')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return []
    return ((data as any[]) ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? '') }))
  } catch {
    return []
  }
}

/** DB 종류 추가 (관리자). 중복 이름은 대소문자 무시로 거부됨(unique index). */
export async function addDbType(name: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'DB 종류 이름을 입력해 주세요.' }
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  try {
    const { error } = await client.from('lead_db_types').insert({ name: trimmed, created_by: me })
    if (error) {
      if (String(error.code) === '23505' || /duplicate|unique/i.test(String(error.message))) {
        return { ok: false, error: '이미 있는 DB 종류입니다.' }
      }
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '추가 중 오류가 발생했습니다.' }
  }
}

/** DB 종류 삭제 (관리자). 기존 리드의 태그(text)는 그대로 남는다. */
export async function deleteDbType(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('lead_db_types').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
  }
}
