import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { INSURERS } from './registrationService'

/**
 * 급여 계산기 서비스.
 *
 * 수당 4종(모집자·상생시상·원수사시상·13개월시상)은 모두 월납보험료 기준 %.
 * - commission_rates: 보험사 × 상품군 요율표 — RLS: 조회=전 직원, 쓰기=owner·admin.
 * - salary_calculations: 저장된 계산 — RLS: 본인 rw, owner·admin 전체 조회(직원 급여 확인).
 *   요율은 저장 시점 스냅샷으로 보존 — 요율표가 바뀌어도 과거 계산은 변하지 않는다.
 * 금액 계산 자체는 클라이언트에서 수행(서버는 저장만).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CommissionRate {
  id: string
  insurer: string
  productGroup: string
  recruiterPct: number
  sangsaengPct: number
  carrierPct: number
  month13Pct: number
  note?: string
  updatedAt: string
}

export interface CommissionRateDraft {
  insurer: string
  productGroup: string
  recruiterPct: number
  sangsaengPct: number
  carrierPct: number
  month13Pct: number
  note?: string
}

export interface SalaryCalc {
  id: string
  staffId: string
  staffName: string
  calcMonth: string // YYYY-MM
  insurer: string
  productGroup: string
  customerName?: string
  monthlyPremium: number
  recruiterPct: number
  sangsaengPct: number
  carrierPct: number
  month13Pct: number
  memo?: string
  createdAt: string
}

export interface SalaryCalcInput {
  calcMonth: string
  insurer: string
  productGroup: string
  customerName?: string
  monthlyPremium: number
  recruiterPct: number
  sangsaengPct: number
  carrierPct: number
  month13Pct: number
  memo?: string
}

/** 계산된 수당 금액(원). immediate = 모집자+상생+원수사(13개월시상 제외). */
export interface SalaryAmounts {
  recruiter: number
  sangsaeng: number
  carrier: number
  month13: number
  immediate: number
  total: number
}

export function calcSalaryAmounts(monthlyPremium: number, pct: {
  recruiterPct: number
  sangsaengPct: number
  carrierPct: number
  month13Pct: number
}): SalaryAmounts {
  const won = (p: number): number => Math.round((monthlyPremium * p) / 100)
  const recruiter = won(pct.recruiterPct)
  const sangsaeng = won(pct.sangsaengPct)
  const carrier = won(pct.carrierPct)
  const month13 = won(pct.month13Pct)
  const immediate = recruiter + sangsaeng + carrier
  return { recruiter, sangsaeng, carrier, month13, immediate, total: immediate + month13 }
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

function numOf(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function mapRate(r: Record<string, any>): CommissionRate {
  return {
    id: String(r.id),
    insurer: String(r.insurer ?? ''),
    productGroup: String(r.product_group ?? '공통'),
    recruiterPct: numOf(r.recruiter_pct),
    sangsaengPct: numOf(r.sangsaeng_pct),
    carrierPct: numOf(r.carrier_pct),
    month13Pct: numOf(r.month13_pct),
    note: (r.note as string | null) ?? undefined,
    updatedAt: String(r.updated_at ?? '')
  }
}

function mapCalc(r: Record<string, any>, names?: Map<string, string>): SalaryCalc {
  const staffId = String(r.staff_id ?? '')
  return {
    id: String(r.id),
    staffId,
    staffName: names?.get(staffId) ?? '',
    calcMonth: String(r.calc_month ?? ''),
    insurer: String(r.insurer ?? ''),
    productGroup: String(r.product_group ?? '공통'),
    customerName: (r.customer_name as string | null) ?? undefined,
    monthlyPremium: numOf(r.monthly_premium),
    recruiterPct: numOf(r.recruiter_pct),
    sangsaengPct: numOf(r.sangsaeng_pct),
    carrierPct: numOf(r.carrier_pct),
    month13Pct: numOf(r.month13_pct),
    memo: (r.memo as string | null) ?? undefined,
    createdAt: String(r.created_at ?? '')
  }
}

function insurerRank(insurer: string): number {
  const i = (INSURERS as readonly string[]).indexOf(insurer)
  return i === -1 ? INSURERS.length : i
}

export function sortRates(items: CommissionRate[]): CommissionRate[] {
  return [...items].sort((a, b) => {
    const r = insurerRank(a.insurer) - insurerRank(b.insurer)
    if (r !== 0) return r
    if (a.insurer !== b.insurer) return a.insurer.localeCompare(b.insurer, 'ko')
    return a.productGroup.localeCompare(b.productGroup, 'ko')
  })
}

/** staff_id → profiles.name (실패 시 빈 맵 — 이름 표시만 빠지고 목록은 정상). */
async function staffNamesFor(client: any, rows: Array<Record<string, any>>): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((r) => String(r.staff_id ?? '')).filter(Boolean)))
  if (ids.length === 0) return new Map()
  try {
    const { data } = await client.from('profiles').select('id, name').in('id', ids)
    return new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [String(p.id), String(p.name ?? '')]))
  } catch {
    return new Map()
  }
}

// ---------- 요율표 ----------

export async function listCommissionRates(): Promise<{ ok: boolean; items: CommissionRate[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 요율표를 불러올 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client.from('commission_rates').select('*').limit(500)
    if (error) return { ok: false, items: [], error: '요율표를 불러오지 못했습니다. (SQL 미적용일 수 있음)' }
    return { ok: true, items: sortRates(((data as any[]) ?? []).map(mapRate)) }
  } catch {
    return { ok: false, items: [], error: '요율표를 불러오지 못했습니다.' }
  }
}

/** 요율 등록/수정 (owner·admin — RLS가 실제 경계). */
export async function saveCommissionRate(draft: CommissionRateDraft, id?: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const row = {
    insurer: draft.insurer.trim(),
    product_group: draft.productGroup.trim() || '공통',
    recruiter_pct: draft.recruiterPct,
    sangsaeng_pct: draft.sangsaengPct,
    carrier_pct: draft.carrierPct,
    month13_pct: draft.month13Pct,
    note: draft.note?.trim() || null,
    updated_by: me,
    updated_at: new Date().toISOString()
  }
  try {
    const q = id
      ? client.from('commission_rates').update(row).eq('id', id)
      : client.from('commission_rates').insert(row)
    const { error } = await q
    if (error) return { ok: false, error: '저장하지 못했습니다. (관리자 권한/중복 보험사×상품군 확인)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장하지 못했습니다.' }
  }
}

export async function deleteCommissionRate(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('commission_rates').delete().eq('id', id)
    if (error) return { ok: false, error: '삭제하지 못했습니다. (관리자 권한 확인)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제하지 못했습니다.' }
  }
}

// ---------- 저장된 계산 ----------

/** 월별 계산 목록 — RLS: FC=본인만, owner·admin=전 직원. */
export async function listSalaryCalcs(month: string): Promise<{ ok: boolean; items: SalaryCalc[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 저장 기능을 쓸 수 있습니다. (계산은 아래에서 바로 가능)' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client
      .from('salary_calculations')
      .select('*')
      .eq('calc_month', month)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return { ok: false, items: [], error: '저장된 계산을 불러오지 못했습니다. (SQL 미적용일 수 있음)' }
    const rows = ((data as any[]) ?? []) as Array<Record<string, any>>
    const names = await staffNamesFor(client, rows)
    return { ok: true, items: rows.map((r) => mapCalc(r, names)) }
  } catch {
    return { ok: false, items: [], error: '저장된 계산을 불러오지 못했습니다.' }
  }
}

export async function createSalaryCalc(input: SalaryCalcInput): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 저장할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const row = {
    staff_id: me,
    calc_month: input.calcMonth,
    insurer: input.insurer.trim(),
    product_group: input.productGroup.trim() || '공통',
    customer_name: input.customerName?.trim() || null,
    monthly_premium: input.monthlyPremium,
    recruiter_pct: input.recruiterPct,
    sangsaeng_pct: input.sangsaengPct,
    carrier_pct: input.carrierPct,
    month13_pct: input.month13Pct,
    memo: input.memo?.trim() || null
  }
  try {
    const { error } = await client.from('salary_calculations').insert(row)
    if (error) return { ok: false, error: '저장하지 못했습니다. (SQL 미적용일 수 있음)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장하지 못했습니다.' }
  }
}

export async function deleteSalaryCalc(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('salary_calculations').delete().eq('id', id)
    if (error) return { ok: false, error: '삭제하지 못했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제하지 못했습니다.' }
  }
}
