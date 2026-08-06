import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { listExcelMonth, listEntriesMonth, buildEffectiveMonthly } from './performanceRecordsService'

/**
 * 급여계산기 '심플' 개편 — 회원(직원)별 매출 요율 + 실적 연동 계산.
 *
 * - salary_member_rates: 직원 1인 = 1행(생명%/손해%/단기납%). RLS: 본인 조회 + owner·admin 전체,
 *   쓰기는 owner·admin (급여는 민감정보).
 * - 매출은 실적(performance_records/entries)에서 그 달 생명/손해/단기납을 자동으로 가져온다
 *   (buildEffectiveMonthly = 엑셀 우선 + 건별 합산). 화면에서 수정 가능.
 * - salary_member_calcs: 회원·귀속월별 저장(요율 스냅샷 보존).
 * 금액 계산 자체는 클라이언트에서 수행(서버는 저장만). ⚠ SQL: SJ_OS_SUPABASE_SALARY_MEMBER_RATES.sql
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MemberRate {
  staffId: string
  staffName?: string
  lifePct: number
  nonLifePct: number
  shortPct: number
  memo?: string
  updatedAt?: string
}

export interface MemberSales {
  life: number
  nonLife: number
  shortTerm: number
}

export interface MemberSalaryBreakdown {
  life: number
  nonLife: number
  short: number
  total: number
}

export interface MemberCalcInput {
  staffId: string
  calcMonth: string
  sales: MemberSales
  rate: { lifePct: number; nonLifePct: number; shortPct: number }
  total: number
  memo?: string
}

export interface SavedMemberCalc {
  id: string
  staffId: string
  staffName: string
  calcMonth: string
  sales: MemberSales
  lifePct: number
  nonLifePct: number
  shortPct: number
  total: number
  memo?: string
  createdAt: string
}

/** 매출 × 회원 요율 = 수당(원). 각 분류는 매출 그대로에 % 적용(단기납 60% 반영이 필요하면 요율에 반영). */
export function calcMemberSalary(sales: MemberSales, rate: { lifePct: number; nonLifePct: number; shortPct: number }): MemberSalaryBreakdown {
  const won = (amt: number, p: number): number => Math.round((amt * p) / 100)
  const life = won(sales.life, rate.lifePct)
  const nonLife = won(sales.nonLife, rate.nonLifePct)
  const short = won(sales.shortTerm, rate.shortPct)
  return { life, nonLife, short, total: life + nonLife + short }
}

function numOf(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}
async function staffNames(client: any, ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  if (uniq.length === 0) return new Map()
  try {
    const { data } = await client.from('profiles').select('id, name').in('id', uniq)
    return new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [String(p.id), String(p.name ?? '')]))
  } catch {
    return new Map()
  }
}

function mapRate(r: Record<string, any>, name?: string): MemberRate {
  return {
    staffId: String(r.staff_id ?? ''),
    staffName: name,
    lifePct: numOf(r.life_pct),
    nonLifePct: numOf(r.non_life_pct),
    shortPct: numOf(r.short_pct),
    memo: (r.memo as string | null) ?? undefined,
    updatedAt: String(r.updated_at ?? '')
  }
}

// ---------- 회원별 요율 ----------

/** 전 직원 요율 목록 (owner·admin — RLS가 실제 경계). staffId → MemberRate. */
export async function listMemberRates(): Promise<{ ok: boolean; items: MemberRate[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 사용할 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client.from('salary_member_rates').select('*').limit(2000)
    if (error) return { ok: false, items: [], error: '요율표를 불러오지 못했습니다. (SQL 미적용일 수 있음)' }
    const rows = ((data as any[]) ?? []) as Array<Record<string, any>>
    const names = await staffNames(client, rows.map((r) => String(r.staff_id ?? '')))
    return { ok: true, items: rows.map((r) => mapRate(r, names.get(String(r.staff_id ?? '')))) }
  } catch {
    return { ok: false, items: [], error: '요율표를 불러오지 못했습니다.' }
  }
}

/** 한 직원의 요율 (본인 또는 관리자). 없으면 0 요율. */
export async function getMemberRate(staffId: string): Promise<MemberRate> {
  const client = await getClient()
  const zero: MemberRate = { staffId, lifePct: 0, nonLifePct: 0, shortPct: 0 }
  if (!client || !staffId) return zero
  try {
    const { data } = await client.from('salary_member_rates').select('*').eq('staff_id', staffId).maybeSingle()
    return data ? mapRate(data) : zero
  } catch {
    return zero
  }
}

/** 요율 등록/수정 (owner·admin — RLS 경계). staff_id upsert. */
export async function saveMemberRate(
  staffId: string,
  rate: { lifePct: number; nonLifePct: number; shortPct: number; memo?: string }
): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const row = {
    staff_id: staffId,
    life_pct: rate.lifePct,
    non_life_pct: rate.nonLifePct,
    short_pct: rate.shortPct,
    memo: rate.memo?.trim() || null,
    updated_by: me,
    updated_at: new Date().toISOString()
  }
  try {
    const { error } = await client.from('salary_member_rates').upsert(row, { onConflict: 'staff_id' })
    if (error) return { ok: false, error: '저장하지 못했습니다. (관리자 권한/SQL 확인)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장하지 못했습니다.' }
  }
}

// ---------- 실적 연동(그 달 매출 자동) ----------

/** 한 직원의 귀속월 생명/손해/단기납 매출 — 실적(엑셀 우선 + 건별 합산)에서. */
export async function memberMonthlySales(staffId: string, month: string): Promise<MemberSales> {
  const zero: MemberSales = { life: 0, nonLife: 0, shortTerm: 0 }
  if (!staffId || !month) return zero
  try {
    const [excel, entries] = await Promise.all([listExcelMonth(month), listEntriesMonth(month)])
    const monthly = buildEffectiveMonthly((excel as any).data ?? [], (entries as any).data ?? [])
    const hit = monthly.find((m) => m.staffId === staffId)
    return hit ? { life: hit.life, nonLife: hit.nonLife, shortTerm: hit.shortTerm } : zero
  } catch {
    return zero
  }
}

// ---------- 저장된 계산 ----------

export async function createMemberCalc(input: MemberCalcInput): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 저장할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const row = {
    staff_id: input.staffId,
    calc_month: input.calcMonth,
    life_sales: input.sales.life,
    non_life_sales: input.sales.nonLife,
    short_sales: input.sales.shortTerm,
    life_pct: input.rate.lifePct,
    non_life_pct: input.rate.nonLifePct,
    short_pct: input.rate.shortPct,
    total: input.total,
    memo: input.memo?.trim() || null,
    created_by: me
  }
  try {
    const { error } = await client.from('salary_member_calcs').insert(row)
    if (error) return { ok: false, error: '저장하지 못했습니다. (SQL 미적용일 수 있음)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장하지 못했습니다.' }
  }
}

export async function listMemberCalcs(month: string): Promise<{ ok: boolean; items: SavedMemberCalc[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 저장 기능을 쓸 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client
      .from('salary_member_calcs')
      .select('*')
      .eq('calc_month', month)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error) return { ok: false, items: [], error: '저장된 계산을 불러오지 못했습니다. (SQL 미적용일 수 있음)' }
    const rows = ((data as any[]) ?? []) as Array<Record<string, any>>
    const names = await staffNames(client, rows.map((r) => String(r.staff_id ?? '')))
    return {
      ok: true,
      items: rows.map((r) => ({
        id: String(r.id),
        staffId: String(r.staff_id ?? ''),
        staffName: names.get(String(r.staff_id ?? '')) ?? '',
        calcMonth: String(r.calc_month ?? ''),
        sales: { life: numOf(r.life_sales), nonLife: numOf(r.non_life_sales), shortTerm: numOf(r.short_sales) },
        lifePct: numOf(r.life_pct),
        nonLifePct: numOf(r.non_life_pct),
        shortPct: numOf(r.short_pct),
        total: numOf(r.total),
        memo: (r.memo as string | null) ?? undefined,
        createdAt: String(r.created_at ?? '')
      }))
    }
  } catch {
    return { ok: false, items: [], error: '저장된 계산을 불러오지 못했습니다.' }
  }
}

export async function deleteMemberCalc(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('salary_member_calcs').delete().eq('id', id)
    if (error) return { ok: false, error: '삭제하지 못했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제하지 못했습니다.' }
  }
}
