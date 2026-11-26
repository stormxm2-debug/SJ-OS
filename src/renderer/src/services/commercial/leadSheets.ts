import { isOverdue, type Lead, type LeadStatus } from './leadService'

/**
 * 업체(회사)별 DB 시트 — 집계 계산(순수 함수).
 * 업체 목록·FC별 개수·상태 요약·엑셀 시트 이름을 만든다. 화면·서버 호출은 하지 않는다.
 */

export const NO_VENDOR = '(업체 미지정)'
export const NO_FC = '(미배정)'

export function vendorOf(l: Pick<Lead, 'vendor'>): string {
  return l.vendor?.trim() || NO_VENDOR
}

export type StatusBucket = 'new' | 'working' | 'won' | 'closed'

const WORKING: LeadStatus[] = ['absent', 'recall', 'called', 'appointment', 'consulting']
const CLOSED: LeadStatus[] = ['rejected', 'invalid', 'fail']

export function bucketOf(status: LeadStatus): StatusBucket {
  if (status === 'new') return 'new'
  if (status === 'contracted') return 'won'
  if (CLOSED.includes(status)) return 'closed'
  if (WORKING.includes(status)) return 'working'
  return 'working'
}

export interface SheetSummary {
  total: number
  assigned: number
  unassigned: number
  uncalled: number
  overdue: number
  working: number
  won: number
  closed: number
}

export function summarize(leads: Lead[]): SheetSummary {
  const s: SheetSummary = { total: leads.length, assigned: 0, unassigned: 0, uncalled: 0, overdue: 0, working: 0, won: 0, closed: 0 }
  for (const l of leads) {
    if (l.assignedFcId) s.assigned += 1
    else s.unassigned += 1
    const b = bucketOf(l.status)
    if (b === 'new') s.uncalled += 1
    else if (b === 'working') s.working += 1
    else if (b === 'won') s.won += 1
    else s.closed += 1
    if (isOverdue(l)) s.overdue += 1
  }
  return s
}

export interface FcRow {
  fcId: string
  name: string
  total: number
  uncalled: number
  working: number
  won: number
  closed: number
}

/** FC별 개수 — 많은 순. 미배정은 마지막 줄. */
export function fcRows(leads: Lead[]): FcRow[] {
  const m = new Map<string, FcRow>()
  for (const l of leads) {
    const key = l.assignedFcId ?? ''
    const row = m.get(key) ?? { fcId: key, name: l.assignedFcId ? l.assignedFcName ?? 'FC' : NO_FC, total: 0, uncalled: 0, working: 0, won: 0, closed: 0 }
    row.total += 1
    const b = bucketOf(l.status)
    if (b === 'new') row.uncalled += 1
    else if (b === 'working') row.working += 1
    else if (b === 'won') row.won += 1
    else row.closed += 1
    m.set(key, row)
  }
  return [...m.values()].sort((a, b) => (a.fcId === '' ? 1 : b.fcId === '' ? -1 : b.total - a.total || a.name.localeCompare(b.name)))
}

export interface VendorTab {
  name: string
  count: number
}

/** 탭용 업체 목록: 등록된 업체(0건 포함) → 데이터에만 있는 업체 → 미지정(있을 때). */
export function vendorTabs(leads: Lead[], registered: string[]): VendorTab[] {
  const counts = new Map<string, number>()
  for (const l of leads) counts.set(vendorOf(l), (counts.get(vendorOf(l)) ?? 0) + 1)
  const out: VendorTab[] = []
  const seen = new Set<string>()
  for (const name of registered) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, count: counts.get(name) ?? 0 })
  }
  const extra = [...counts.keys()].filter((n) => !seen.has(n) && n !== NO_VENDOR).sort((a, b) => a.localeCompare(b))
  for (const name of extra) out.push({ name, count: counts.get(name) ?? 0 })
  if ((counts.get(NO_VENDOR) ?? 0) > 0) out.push({ name: NO_VENDOR, count: counts.get(NO_VENDOR) ?? 0 })
  return out
}

/** 엑셀 시트 이름: 금지 문자 제거·31자 제한·중복 방지. */
export function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || '시트'
  let name = base
  let i = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${i})`
    name = base.slice(0, 31 - suffix.length) + suffix
    i += 1
  }
  used.add(name.toLowerCase())
  return name
}
