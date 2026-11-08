import { collectHrSections, looksSurgery, normalizeDisease, num, ymd8, type Row } from './summarize'
import type { UnderwritingDisease } from '../underwriting/underwritingService'
import type { ExceptionRule } from '../underwriting/exceptionDiseaseService'
import { classifyHealthError } from './healthStatusView'

export type CarePeriod = 'all' | '3m' | '1y' | '3y' | '5y'
export type ClaimState = 'unknown' | 'unclaimed' | 'claimed'
export const CLAIM_LABELS: Record<ClaimState, string> = { unknown: '미확인', unclaimed: '미청구', claimed: '청구 완료' }
export const CARE_PERIODS: { value: CarePeriod; label: string }[] = [
  { value: '3m', label: '3개월' }, { value: '1y', label: '1년' }, { value: '3y', label: '3년' }, { value: '5y', label: '5년' }, { value: 'all', label: '전체' }
]
const text = (r: Row, keys: string[]): string => keys.map(k => String(r[k] ?? '').trim()).find(Boolean) ?? ''
export const careDate = (r: Row): string => ymd8(text(r, ['resTreatStartDate', 'resTreatDate', 'resDate', 'commStartDate', 'resPrescribeDate', 'resDispenseDate']))
const hospital = (r: Row): string => text(r, ['resHospitalName', 'resPharmacyName', 'resOrgName'])
export function localYmd(today = new Date()): string {
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
}
export function validCareDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}
export function periodStart(period: Exclude<CarePeriod, 'all'>, today = new Date()): string {
  const months = { '3m': 3, '1y': 12, '3y': 36, '5y': 60 }[period]
  return calendarMonthsAgo(months, today)
}
export function calendarMonthsAgo(months: number, today = new Date()): string {
  const target = new Date(Date.UTC(today.getFullYear(), today.getMonth() - months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}${String(target.getUTCMonth() + 1).padStart(2, '0')}${String(Math.min(today.getDate(), last)).padStart(2, '0')}`
}
export function filterCareResult(result: Record<string, unknown>, period: CarePeriod, today = new Date()): Record<string, unknown> {
  if (period === 'all') return result
  const start = periodStart(period, today), end = localYmd(today)
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Array.isArray(value)
    ? value.filter(row => row && typeof row === 'object' && validCareDate(careDate(row)) && careDate(row) >= start && careDate(row) <= end)
    : value]))
}
export function sideFromSource(row: Row): string {
  const explicit = text(row, ['resLaterality', 'resSide', 'resBodySide'])
  if (/^(left|l|lt)$/i.test(explicit)) return '왼쪽'
  if (/^(right|r|rt)$/i.test(explicit)) return '오른쪽'
  const value = [explicit, text(row, ['resDiseaseName', 'resSickName']), text(row, ['resOperationName', 'resSurgeryName', 'resCodeName'])].join(' ')
  const left = /왼쪽|좌측|좌안|좌슬|좌견|좌족|좌수/.test(value)
  const right = /오른쪽|우측|우안|우슬|우견|우족|우수/.test(value)
  if (/양측|양쪽/.test(value) || (left && right)) return '양측 / 복수 표기'
  return left ? '왼쪽' : right ? '오른쪽' : '미확인'
}
export function fluMedication(name: string, ingredient = ''): boolean {
  // Display-only review cue, not drug eligibility or a reimbursement decision.
  return /오셀타미비르|페라미비르|자나미비르|발록사비르|타미플루|페라미플루|리렌자|조플루자|oseltamivir|peramivir|zanamivir|baloxavir/i.test(`${name} ${ingredient}`)
}
export interface CareRecord {
  key: string
  date: string
  hospital: string
  disease: string
  code: string
  side: string
  kind: '입원' | '통원' | '확인 필요'
  surgery: boolean
  admissionDays: number | null
  medications: { name: string; ingredient: string; days: number; flu: boolean }[]
  procedures: string[]
  selfPay: number
}
export function buildCareRecords(result: Record<string, unknown>): CareRecord[] {
  const sections = collectHrSections(result)
  const rows: CareRecord[] = []
  const seen = new Set<string>()
  const base = [...sections.basic, ...sections.detail.filter(detail => {
    const date = careDate(detail), hosp = hospital(detail)
    return !(validCareDate(date) && hosp && sections.basic.some(b => careDate(b)===date && hospital(b)===hosp))
  })]
  for (const basic of base) {
    const date = careDate(basic), hosp = hospital(basic)
    const disease = text(basic, ['resDiseaseName', 'resSickName', 'resDisease']) || '상병 정보 없음'
    const code = text(basic, ['resDiseaseCode', 'resSickCode', 'resDiseaseCd', 'resMainSickCode']) || (disease.match(/\(([A-Z]\d{2}(?:\.?\d+)?)\)/i)?.[1] ?? '')
    const type = text(basic, ['resTreatType', 'resType'])
    const key = JSON.stringify([date, hosp, disease, code, type, validCareDate(date) && hosp ? null : basic])
    if (seen.has(key)) continue
    seen.add(key)
    // Never associate two records whose date or institution is unknown.
    const matches = (r: Row): boolean => validCareDate(date) && !!hosp && careDate(r) === date && hospital(r) === hosp
    const detail = sections.detail.filter(matches)
    const prescribe = sections.prescribe.filter(matches)
    const kind = /입원/.test(type) ? '입원' : /외래|통원|요양|약국/.test(type) ? '통원' : '확인 필요'
    const dayValue = text(basic, ['resInpatientDays', 'resHospitalDays', 'resVisitDays'])
    const dayNumber = num(dayValue)
    const admissionDays = kind === '입원' && /^\d+(?:\.0+)?$/.test(dayValue) && Number.isInteger(dayNumber) && dayNumber > 0 ? dayNumber : null
    const names = detail.map(r => text(r, ['resOperationName', 'resSurgeryName', 'resCodeName', 'resTreatMeaning']))
    const medications = prescribe.map(r => {
      const name = text(r, ['resDrugName', 'resMedicineName']), ingredient = text(r, ['resIngredients', 'resIngredient'])
      return { name, ingredient, days: num(r.resTotalDosingdays ?? r.resPrescribeDays ?? r.resMedicationDays), flu: fluMedication(name, ingredient) }
    }).filter(m => !!m.name)
    rows.push({ key, date, hospital: hosp, disease, code, kind, admissionDays,
      side: sideFromSource(basic), surgery: /수술/.test(type) || detail.some((r, i) => looksSurgery(names[i], text(r, ['resTreatType', 'resType']))),
      medications: medications.filter((m, i, all) => all.findIndex(x => x.name === m.name && x.ingredient === m.ingredient && x.days === m.days) === i),
      procedures: [...new Set(names.filter(Boolean))], selfPay: num(basic.resDeductibleAmt ?? basic.resSelfPay) })
  }
  // Preserve standalone pharmacy records: institution differs from the prescriber.
  for (const med of sections.prescribe) {
    const date = careDate(med), hosp = hospital(med)
    if (validCareDate(date) && hosp && rows.some(r => r.date === date && r.hospital === hosp)) continue
    const name = text(med, ['resDrugName', 'resMedicineName'])
    if (!name) continue
    const ingredient = text(med, ['resIngredients', 'resIngredient'])
    const key = JSON.stringify(['medication', date, hosp, name, ingredient])
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ key, date, hospital: hosp, disease: '약물 단독 기록 · 상병 연결 미확인', code: '', side: '미확인', kind: '확인 필요', surgery: false, admissionDays: null,
      medications: [{ name, ingredient, days: num(med.resTotalDosingdays ?? med.resPrescribeDays ?? med.resMedicationDays), flu: fluMedication(name, ingredient) }], procedures: [], selfPay: 0 })
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
}
export async function claimRecordKey(record: CareRecord): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.key))
  return 'hrv1-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
export interface GuideCheck { disease: string; insurer: string; status: string; note: string; verified: boolean }
export interface HrUnderwritingContext { insurers: string[]; guides: GuideCheck[]; exceptions: ExceptionRule[] }
export function matchCareGuides(rows: CareRecord[], guides: UnderwritingDisease[], exceptions: ExceptionRule[], insurers: string[]): HrUnderwritingContext {
  const normalized = (s: string): string => normalizeDisease(s).replace(/\s/g, '').toLowerCase()
  const names = new Set(rows.map(r => normalized(r.disease)))
  // Conservative exact name/alias matches. Missing criteria never mean approval.
  const matches = (name: string, aliases: string[]): boolean => [name, ...aliases].some(n => !!normalized(n) && names.has(normalized(n)))
  return { insurers, guides: guides.filter(g => matches(g.name, g.aliases)).flatMap(g => insurers.flatMap(insurer => {
    const rule = g.rules[insurer]
    return rule ? [{ disease: g.name, insurer, status: rule.status, note: rule.note ?? '', verified: rule.verified }] : []
  })), exceptions: exceptions.filter(e => insurers.includes(e.insurer) && matches(e.disease, e.searchTerms)) }
}
export function admissionSummary(rows: CareRecord[]): { knownDays: number; unknown: number } {
  const visits = new Map<string, number | null>()
  for (const r of rows.filter(r => r.kind === '입원')) {
    const key = JSON.stringify([r.date, r.hospital])
    const previous = visits.get(key)
    visits.set(key, r.admissionDays == null ? previous ?? null : Math.max(previous ?? 0, r.admissionDays))
  }
  return { knownDays: [...visits.values()].reduce<number>((n, d) => n + (d ?? 0), 0), unknown: [...visits.values()].filter(d => d == null).length }
}
/** 표시용 오류 안내(제목·행동). 분류는 healthStatusView.classifyHealthError 와 공유. */
export function healthErrorHelp(message: string, code = ''): { title: string; action: string } {
  const v = classifyHealthError(message, code)
  return { title: v.title, action: v.action }
}
export interface RecentCareSummary {
  /** Selected window (inclusive). Empty strings for 'all'. */
  start: string
  end: string
  /** Records shown for the period — identical to buildCareRecords(filterCareResult(result, period)), newest first. */
  records: CareRecord[]
  /** Records whose date is missing or invalid (shown only under 'all'). */
  undated: number
  /** All records in the fetched result (any date). */
  total: number
  /** Oldest/latest valid dates actually present — not the requested inquiry range. */
  oldest: string
  latest: string
}
/** Saved-result display filter for the summary list. Never triggers a new inquiry. */
export function careListSummary(result: Record<string, unknown>, period: CarePeriod, today = new Date()): RecentCareSummary {
  const all = buildCareRecords(result)
  const dated = all.map(r => r.date).filter(validCareDate).sort()
  return {
    start: period === 'all' ? '' : periodStart(period, today), end: period === 'all' ? '' : localYmd(today),
    records: period === 'all' ? all : buildCareRecords(filterCareResult(result, period, today)),
    undated: all.filter(r => !validCareDate(r.date)).length,
    total: all.length, oldest: dated[0] ?? '', latest: dated[dated.length - 1] ?? ''
  }
}
/** Recent 3 calendar months (reference only, not a disclosure decision). */
export function recentCareSummary(result: Record<string, unknown>, today = new Date()): RecentCareSummary {
  return careListSummary(result, '3m', today)
}
export interface CareKpis {
  /** Record count (same meaning as the list; not de-duplicated visits). */
  records: number
  admissionKnownDays: number
  /** Admission visits whose day count is missing — never counted as 0. */
  admissionUnknown: number
  /** Distinct date·institution visits with a name-based surgery estimate. */
  surgeries: number
}
export function careKpis(rows: CareRecord[]): CareKpis {
  const a = admissionSummary(rows)
  return { records: rows.length, admissionKnownDays: a.knownDays, admissionUnknown: a.unknown,
    surgeries: new Set(rows.filter(r => r.surgery).map(r => JSON.stringify([r.date, r.hospital]))).size }
}
