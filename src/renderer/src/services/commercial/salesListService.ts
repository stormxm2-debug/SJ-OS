/**
 * 영업·리쿠르팅 리스트 서비스 (전산).
 *
 * 사용자(FC) 본인의 월별 리스트를 Supabase에 저장/수정하고, 완료 체크·엑셀
 * 다운로드를 제공한다. 미완료(done=false) 건의 다음 달 자동 이월은 서버 함수
 * `ensure_sales_month(p_month)`가 담당한다(완료 건은 '완료 보관함'에만 남는다).
 *
 * - supabase 모드에서만 실제 동작. local-mock(데모)에서는 빈 배열/no-op로 안전.
 * - RLS가 본인 행만 노출하지만, 관리자 계정도 '내 리스트'만 보도록 staff_id로 한 번 더 건다.
 */
import { initSupabaseClient, getSupabaseClient } from './supabaseClient'
import { getBackendConfig } from './backendConfig'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ListKind = 'customer' | 'recruit'

export interface FieldDef {
  key: string
  col: string
  label: string
  width: number
}

/** 고객 영업 리스트 입력 칸 (이름 → 소개인원). */
export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'name', col: 'name', label: '이름', width: 14 },
  { key: 'kakaoAp', col: 'kakao_ap', label: '카톡AP', width: 10 },
  { key: 'taAp', col: 'ta_ap', label: 'TA AP', width: 10 },
  { key: 'apMeet', col: 'ap_meet', label: 'AP만남', width: 11 },
  { key: 'consult1', col: 'consult1', label: '1차상담', width: 10 },
  { key: 'consult2', col: 'consult2', label: '2차상담', width: 10 },
  { key: 'contractExpected', col: 'contract_expected', label: '계약예정', width: 10 },
  { key: 'contract', col: 'contract', label: '계약', width: 9 },
  { key: 'policyDelivered', col: 'policy_delivered', label: '증권전달', width: 10 },
  { key: 'giftDelivered', col: 'gift_delivered', label: '선물전달', width: 10 },
  { key: 'referrals', col: 'referrals', label: '소개인원', width: 10 }
]

/** 리쿠르팅(CIS) 리스트 입력 칸 (이름 → 대표 버즈). */
export const RECRUIT_FIELDS: FieldDef[] = [
  { key: 'name', col: 'name', label: '이름', width: 13 },
  { key: 'age', col: 'age', label: '나이', width: 7 },
  { key: 'regionJob', col: 'region_job', label: '지역/직업', width: 12 },
  { key: 'contact', col: 'contact', label: '연락처', width: 15 },
  { key: 'apMeet', col: 'ap_meet', label: 'AP만남', width: 10 },
  { key: 'meet1', col: 'meet1', label: '1차만남', width: 10 },
  { key: 'meet2', col: 'meet2', label: '2차만남', width: 10 },
  { key: 'meet3', col: 'meet3', label: '3차만남', width: 10 },
  { key: 'consultDone', col: 'consult_done', label: '상담완료', width: 10 },
  { key: 'contractDone', col: 'contract_done', label: '계약완료', width: 10 },
  { key: 'bmCis1', col: 'bm_cis1', label: 'BM CIS1차', width: 11 },
  { key: 'bmCis2', col: 'bm_cis2', label: 'BM CIS2차', width: 11 },
  { key: 'enrollExpected', col: 'enroll_expected', label: '입과예상일', width: 11 },
  { key: 'repBuzz', col: 'rep_buzz', label: '대표 버즈', width: 10 }
]

export const FIELDS: Record<ListKind, FieldDef[]> = {
  customer: CUSTOMER_FIELDS,
  recruit: RECRUIT_FIELDS
}
const TABLE: Record<ListKind, string> = {
  customer: 'sales_customer_rows',
  recruit: 'sales_recruit_rows'
}

/** 실시간 동기화 대상 (모듈 상수 — useRealtimeSync 안정화용). */
export const SALES_RT_TABLES = ['sales_customer_rows', 'sales_recruit_rows']

export interface ListRow {
  id: string
  month: string
  done: boolean
  doneAt: string | null
  orderIndex: number
  values: Record<string, string>
}

export function isSupabaseMode(): boolean {
  return getBackendConfig().mode === 'supabase'
}

export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' → 다음/이전 달. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10))
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function sb(): Promise<any | null> {
  if (getBackendConfig().mode !== 'supabase') return null
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function uid(client: any): Promise<string | null> {
  const { data } = await client.auth.getSession()
  return data?.session?.user?.id ?? null
}

function mapRow(kind: ListKind, r: any): ListRow {
  const values: Record<string, string> = {}
  for (const f of FIELDS[kind]) values[f.key] = r[f.col] ?? ''
  return {
    id: r.id,
    month: r.month,
    done: !!r.done,
    doneAt: r.done_at ?? null,
    orderIndex: r.order_index ?? 0,
    values
  }
}

/** 대상 월 진입 시 1회: 지난달 미완료 건을 이번 달로 자동 이월(서버 함수). */
export async function ensureMonth(month: string): Promise<void> {
  const c = await sb()
  if (!c) return
  await c.rpc('ensure_sales_month', { p_month: month })
}

/** 한 종류의 행을 조회. done=false → 현재 리스트, done=true → 완료 보관함. */
export async function listRows(
  kind: ListKind,
  opts: { month?: string; done: boolean }
): Promise<ListRow[]> {
  const c = await sb()
  if (!c) return []
  const u = await uid(c)
  if (!u) return []
  let q = c.from(TABLE[kind]).select('*').eq('staff_id', u).eq('done', opts.done)
  if (opts.month) q = q.eq('month', opts.month)
  q = opts.done
    ? q.order('done_at', { ascending: false })
    : q.order('order_index', { ascending: true })
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map((r: any) => mapRow(kind, r))
}

export async function addRow(kind: ListKind, month: string, orderIndex: number): Promise<ListRow> {
  const c = await sb()
  if (!c) throw new Error('전산(서버) 연동이 필요합니다.')
  const { data, error } = await c
    .from(TABLE[kind])
    .insert({ month, order_index: orderIndex })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return mapRow(kind, data)
}

export async function updateField(
  kind: ListKind,
  id: string,
  fieldKey: string,
  value: string
): Promise<void> {
  const c = await sb()
  if (!c) return
  const f = FIELDS[kind].find((x) => x.key === fieldKey)
  if (!f) return
  const { error } = await c.from(TABLE[kind]).update({ [f.col]: value }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** 완료 체크/해제. 완료 시 현재 리스트에서 빠지고 보관함으로 이동(done=true). */
export async function setDone(kind: ListKind, id: string, done: boolean): Promise<void> {
  const c = await sb()
  if (!c) return
  const { error } = await c
    .from(TABLE[kind])
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteRow(kind: ListKind, id: string): Promise<void> {
  const c = await sb()
  if (!c) return
  const { error } = await c.from(TABLE[kind]).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─────────────────────────── 엑셀 다운로드 ───────────────────────────
const NAVY = 'FF0E1E3A'
const HEAD = 'FF2E4A74'
const STRIPE = 'FFEEF3FA'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function loadExcelJs(): Promise<any> {
  const mod = await import('exceljs')
  return (mod as any).default ?? mod
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 현재 월 리스트(또는 완료 보관함)를 브랜드 색 엑셀 한 장으로 내려받는다. */
export async function exportExcel(
  month: string,
  customers: ListRow[],
  recruits: ListRow[],
  opts?: { archive?: boolean }
): Promise<void> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(month)
  const title = opts?.archive ? `완료 보관함 (${month})` : `FC 영업 · 리쿠르팅 리스트 (${month})`

  const section = (titleText: string, fields: FieldDef[], rows: ListRow[], startRow: number): number => {
    let r = startRow
    const last = fields.length
    ws.mergeCells(r, 1, r, last)
    const band = ws.getCell(r, 1)
    band.value = titleText
    band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    band.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    band.alignment = { vertical: 'middle' }
    ws.getRow(r).height = 22
    r += 1
    const hdr = ws.getRow(r)
    fields.forEach((f, i) => {
      const c = hdr.getCell(i + 1)
      c.value = f.label
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
      c.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, f.width)
    })
    r += 1
    rows.forEach((row, idx) => {
      const rr = ws.getRow(r)
      fields.forEach((f, i) => {
        const c = rr.getCell(i + 1)
        c.value = row.values[f.key] ?? ''
        c.alignment = { horizontal: 'center', vertical: 'middle' }
        c.font = { name: 'Arial', size: 10 }
        if (idx % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } }
        c.border = {
          top: { style: 'thin', color: { argb: 'FFD4DBE6' } },
          bottom: { style: 'thin', color: { argb: 'FFD4DBE6' } },
          left: { style: 'thin', color: { argb: 'FFD4DBE6' } },
          right: { style: 'thin', color: { argb: 'FFD4DBE6' } }
        }
      })
      r += 1
    })
    return r + 1
  }

  ws.mergeCells(1, 1, 1, 14)
  const t = ws.getCell(1, 1)
  t.value = title
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  t.font = { name: 'Arial', bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  t.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 30

  let row = 3
  row = section('① 고객 영업 리스트', CUSTOMER_FIELDS, customers, row)
  section('② 리쿠르팅(CIS) 리스트', RECRUIT_FIELDS, recruits, row)

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  const buf = await wb.xlsx.writeBuffer()
  const name = opts?.archive ? `완료보관함_${month}.xlsx` : `영업리쿠르팅_${month}.xlsx`
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), name)
}
