import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 실적 서비스 — 건별 입력(performance_entries) + 관리자 엑셀(performance_records).
 *
 * 규칙:
 *  - 분류 3종: 생명보험(life) / 손해보험(non-life→nonLife) / 단기납종신(short-term)
 *  - 매출 합계 = 생명 + 손해 + 단기납종신 × 60% (SHORT_TERM_RATE)
 *  - 직원은 **계약이 들어올 때마다 한 건씩** 추가하고, 실수하면 그 건만 수정/삭제.
 *    월 합계·계약건수는 건들의 자동 합산.
 *  - 관리자 엑셀 업로드(source='excel', 월 단위 총액)가 있으면 그 직원·그 달은
 *    **엑셀이 우선** — 건별 합산 대신 엑셀 값이 유효 실적이 된다.
 *
 * SECURITY: anon public client only (RLS이 실제 경계). 건별 행은 본인(또는 관리자)만
 * 쓰기, excel 행은 owner/admin만. 조회 범위 FC=본인, 팀장=팀, 관리자=전체.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SHORT_TERM_RATE = 0.6

export type PerformanceSource = 'self' | 'excel'
export type PerformanceCategory = 'life' | 'non-life' | 'short-term'

export const CATEGORY_LABEL: Record<PerformanceCategory, string> = {
  life: '생명보험',
  'non-life': '손해보험',
  'short-term': '단기납종신'
}

/** 월 단위 유효 실적(엑셀 행 또는 건별 합산) — 화면 표시용. */
export interface PerformanceEntry {
  id: string
  staffId: string
  staffName: string
  teamId?: string
  month: string // YYYY-MM
  life: number
  nonLife: number
  shortTerm: number
  contractCount: number
  source: PerformanceSource
  updatedAt: string
}

/** 건별 계약 실적 한 건. */
export interface ContractEntry {
  id: string
  staffId: string
  staffName: string
  teamId?: string
  entryDate: string // YYYY-MM-DD
  month: string // YYYY-MM
  category: PerformanceCategory
  amount: number
  memo?: string
  updatedAt: string
}

export interface ContractEntryInput {
  entryDate: string // YYYY-MM-DD
  category: PerformanceCategory
  amount: number
  memo?: string
}

export interface PerformanceInput {
  life: number
  nonLife: number
  shortTerm: number
  contractCount: number
}

export interface StaffDirectoryEntry {
  profileId: string
  name: string
  normalizedPhone: string
  teamId?: string
}

export type AdapterReason = 'not-configured' | 'no-session' | 'error'
export type AdapterResult<T> = { ok: true; data: T } | { ok: false; reason: AdapterReason; message: string }

function err<T = never>(reason: AdapterReason, message: string): AdapterResult<T> {
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

/** 매출 합계(원) = 생명 + 손해 + 단기납종신×60%. */
export function weightedTotal(e: { life: number; nonLife: number; shortTerm: number }): number {
  return Math.round(e.life + e.nonLife + e.shortTerm * SHORT_TERM_RATE)
}

/** 이번 달 키(YYYY-MM, 로컬 시간 기준). */
export function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 오늘 날짜(YYYY-MM-DD, 로컬). */
export function todayDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
}
export function monthOfDate(date: string): string {
  return date.slice(0, 7)
}

// --- 건별 실적 (performance_entries) ----------------------------------------

const ENTRY_COLS = 'id, staff_id, team_id, entry_date, month, category, amount, memo, updated_at, staff:profiles(id, name, team_id)'

function mapEntry(row: Record<string, any>): ContractEntry {
  const staff = (row.staff as Record<string, any> | null) ?? null
  return {
    id: String(row.id),
    staffId: String(row.staff_id ?? ''),
    staffName: staff ? String(staff.name ?? '') : '',
    teamId: (row.team_id as string | null) ?? (staff ? ((staff.team_id as string | null) ?? undefined) : undefined),
    entryDate: String(row.entry_date ?? ''),
    month: String(row.month ?? ''),
    category: (row.category as PerformanceCategory) ?? 'life',
    amount: Number(row.amount ?? 0),
    memo: (row.memo as string | null) ?? undefined,
    updatedAt: String(row.updated_at ?? '')
  }
}

/** 해당 월의 건별 실적(권한 범위 내). */
export async function listEntriesMonth(month: string): Promise<AdapterResult<ContractEntry[]>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { data, error } = await client
      .from('performance_entries')
      .select(ENTRY_COLS)
      .eq('month', month)
      .order('entry_date', { ascending: false })
      .order('updated_at', { ascending: false })
    if (error) return err('error', '실적 목록을 불러오지 못했습니다.')
    return { ok: true, data: ((data as any[]) ?? []).map(mapEntry) }
  } catch {
    return err('error', '실적 목록을 불러오지 못했습니다.')
  }
}

/** 계약 한 건 추가 (본인). */
export async function addEntry(input: ContractEntryInput): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  const uid = await currentUserId(client)
  if (!uid) return err('no-session', '로그인 세션이 없습니다.')
  const month = monthOfDate(input.entryDate)
  if (!isValidMonth(month)) return err('error', '날짜 형식이 올바르지 않습니다.')
  if (!(input.amount > 0)) return err('error', '금액을 입력해주세요.')
  try {
    const { error } = await client.from('performance_entries').insert({
      staff_id: uid,
      entry_date: input.entryDate,
      month,
      category: input.category,
      amount: Math.round(input.amount),
      memo: input.memo?.trim() || null
    })
    if (error) return err('error', '실적 추가에 실패했습니다.')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '실적 추가에 실패했습니다.')
  }
}

/** 계약 건 수정 (본인 것만 — RLS 강제). */
export async function updateEntry(id: string, input: ContractEntryInput): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  const month = monthOfDate(input.entryDate)
  if (!isValidMonth(month)) return err('error', '날짜 형식이 올바르지 않습니다.')
  if (!(input.amount > 0)) return err('error', '금액을 입력해주세요.')
  try {
    const { error } = await client
      .from('performance_entries')
      .update({
        entry_date: input.entryDate,
        month,
        category: input.category,
        amount: Math.round(input.amount),
        memo: input.memo?.trim() || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
    if (error) return err('error', '실적 수정에 실패했습니다.')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '실적 수정에 실패했습니다.')
  }
}

/** 계약 건 삭제 (본인 것만 — RLS 강제). */
export async function deleteEntry(id: string): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { error } = await client.from('performance_entries').delete().eq('id', id)
    if (error) return err('error', '실적 삭제에 실패했습니다.')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '실적 삭제에 실패했습니다.')
  }
}

// --- 월 단위 엑셀 실적 (performance_records, source='excel') -------------------

const RECORD_COLS = 'id, staff_id, month, life_premium, non_life_premium, short_term_premium, contract_count, source, updated_at, staff:profiles(id, name, team_id)'

function mapRecord(row: Record<string, any>): PerformanceEntry {
  const staff = (row.staff as Record<string, any> | null) ?? null
  return {
    id: String(row.id),
    staffId: String(row.staff_id ?? ''),
    staffName: staff ? String(staff.name ?? '') : '',
    teamId: staff ? ((staff.team_id as string | null) ?? undefined) : undefined,
    month: String(row.month ?? ''),
    life: Number(row.life_premium ?? 0),
    nonLife: Number(row.non_life_premium ?? 0),
    shortTerm: Number(row.short_term_premium ?? 0),
    contractCount: Number(row.contract_count ?? 0),
    source: (row.source as PerformanceSource) ?? 'self',
    updatedAt: String(row.updated_at ?? '')
  }
}

/** 해당 월의 엑셀(관리자 업로드) 실적 행. */
export async function listExcelMonth(month: string): Promise<AdapterResult<PerformanceEntry[]>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { data, error } = await client
      .from('performance_records')
      .select(RECORD_COLS)
      .eq('month', month)
      .eq('source', 'excel')
    if (error) return err('error', '엑셀 실적을 불러오지 못했습니다.')
    return { ok: true, data: ((data as any[]) ?? []).map(mapRecord) }
  } catch {
    return err('error', '엑셀 실적을 불러오지 못했습니다.')
  }
}

/** 관리자: 직원 디렉토리(엑셀 매칭용 — 계정 생성된 직원만). RLS: owner/admin 전용. */
export async function loadStaffDirectory(): Promise<AdapterResult<StaffDirectoryEntry[]>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { data, error } = await client
      .from('staff_login_accounts')
      .select('profile_id, name, normalized_phone, team_id')
      .not('profile_id', 'is', null)
    if (error) return err('error', '직원 목록을 불러오지 못했습니다 (관리자 전용).')
    const rows = ((data as any[]) ?? []).map((r) => ({
      profileId: String(r.profile_id),
      name: String(r.name ?? ''),
      normalizedPhone: String(r.normalized_phone ?? ''),
      teamId: (r.team_id as string | null) ?? undefined
    }))
    return { ok: true, data: rows }
  } catch {
    return err('error', '직원 목록을 불러오지 못했습니다.')
  }
}

export interface ExcelApplyRow {
  staffId: string
  teamId?: string
  month: string
  input: PerformanceInput
}

/** 관리자: 엑셀 행 일괄 반영 (upsert, source='excel' — 그 달 그 직원의 우선 실적). */
export async function adminApplyExcelRows(rows: ExcelApplyRow[]): Promise<AdapterResult<{ applied: number }>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  if (rows.length === 0) return { ok: true, data: { applied: 0 } }
  try {
    const now = new Date().toISOString()
    const payload = rows.map((r) => ({
      staff_id: r.staffId,
      team_id: r.teamId ?? null,
      month: r.month,
      life_premium: Math.max(0, Math.round(r.input.life)),
      non_life_premium: Math.max(0, Math.round(r.input.nonLife)),
      short_term_premium: Math.max(0, Math.round(r.input.shortTerm)),
      total_premium: weightedTotal(r.input),
      contract_count: Math.max(0, Math.round(r.input.contractCount)),
      source: 'excel',
      updated_at: now
    }))
    const { error } = await client
      .from('performance_records')
      .upsert(payload, { onConflict: 'staff_id,month,source' })
    if (error) return err('error', '엑셀 실적 반영에 실패했습니다 (관리자 권한 필요).')
    return { ok: true, data: { applied: payload.length } }
  } catch {
    return err('error', '엑셀 실적 반영에 실패했습니다.')
  }
}

/** 관리자: 특정 월의 엑셀 실적 전체 삭제 (건별 입력으로 되돌리기). */
export async function adminDeleteExcelMonth(month: string): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { error } = await client.from('performance_records').delete().eq('month', month).eq('source', 'excel')
    if (error) return err('error', '엑셀 실적 삭제에 실패했습니다.')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '엑셀 실적 삭제에 실패했습니다.')
  }
}

// --- 집계 (엑셀 우선 규칙) -----------------------------------------------------

/** 건별 실적 → 직원별 월 합산(source='self'). 계약건수 = 건 수. */
export function aggregateEntries(entries: ContractEntry[]): PerformanceEntry[] {
  const byStaff = new Map<string, PerformanceEntry>()
  for (const e of entries) {
    let agg = byStaff.get(e.staffId)
    if (!agg) {
      agg = {
        id: `agg-${e.staffId}`,
        staffId: e.staffId,
        staffName: e.staffName,
        teamId: e.teamId,
        month: e.month,
        life: 0,
        nonLife: 0,
        shortTerm: 0,
        contractCount: 0,
        source: 'self',
        updatedAt: e.updatedAt
      }
      byStaff.set(e.staffId, agg)
    }
    if (e.category === 'life') agg.life += e.amount
    else if (e.category === 'non-life') agg.nonLife += e.amount
    else agg.shortTerm += e.amount
    agg.contractCount += 1
    if (e.updatedAt > agg.updatedAt) agg.updatedAt = e.updatedAt
  }
  return [...byStaff.values()]
}

/** 유효 실적: 직원별로 엑셀 행이 있으면 엑셀, 없으면 건별 합산. (엑셀 우선) */
export function buildEffectiveMonthly(excelRows: PerformanceEntry[], entries: ContractEntry[]): PerformanceEntry[] {
  const result = new Map<string, PerformanceEntry>()
  for (const agg of aggregateEntries(entries)) result.set(agg.staffId, agg)
  for (const ex of excelRows) result.set(ex.staffId, ex) // 엑셀 우선 덮어쓰기
  return [...result.values()]
}

export interface PerformanceTotals {
  life: number
  nonLife: number
  shortTerm: number
  shortTermWeighted: number
  total: number
  contractCount: number
  staffCount: number
}

/** 분류별 합계 + 총 매출(단기납 60% 반영). */
export function summarize(entries: PerformanceEntry[]): PerformanceTotals {
  const t: PerformanceTotals = { life: 0, nonLife: 0, shortTerm: 0, shortTermWeighted: 0, total: 0, contractCount: 0, staffCount: entries.length }
  for (const e of entries) {
    t.life += e.life
    t.nonLife += e.nonLife
    t.shortTerm += e.shortTerm
    t.contractCount += e.contractCount
  }
  t.shortTermWeighted = Math.round(t.shortTerm * SHORT_TERM_RATE)
  t.total = Math.round(t.life + t.nonLife + t.shortTerm * SHORT_TERM_RATE)
  return t
}
