import { collectHrSections, looksSurgery, normalizeDisease, num, ymd8, type Row } from './summarize'
import type { UnderwritingDisease } from '../underwriting/underwritingService'
import type { ExceptionRule } from '../underwriting/exceptionDiseaseService'

export type CarePeriod = 'all' | '3m' | '1y' | '3y' | '5y'
export type ClaimState = 'unknown' | 'unclaimed' | 'claimed'
export const CLAIM_LABELS: Record<ClaimState, string> = { unknown: '미확인', unclaimed: '미청구', claimed: '청구 완료' }
export const CARE_PERIODS: { value: CarePeriod; label: string }[] = [
  { value: '3m', label: '3개월' }, { value: '1y', label: '1년' }, { value: '3y', label: '3년' }, { value: '5y', label: '5년' }, { value: 'all', label: '조회 전체' }
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
export function healthErrorHelp(message: string, code = ''): { title: string; action: string } {
  if (/TIMEOUT|시간.*초과|응답.*지연/i.test(`${code} ${message}`)) return { title: '조회 응답 지연', action: '최근 요청을 새로고침해 완료 여부를 먼저 확인하세요. 화면 시간초과 후에도 서버 작업은 끝날 수 있습니다.' }
  if (/이용.*시간|운영.*시간|점검|서비스.*시간/.test(message)) return { title: '기관 이용 시간 확인', action: '기관·연동업체의 공식 이용 시간을 확인한 뒤 다시 요청하세요. 오전 9시 제한은 아직 확인되지 않았습니다.' }
  if (/외국인|성명|이름|userName/i.test(message)) return { title: '고객 이름 확인', action: '외국인 이름의 공백·순서·길이를 확인하세요. 인증사업자에 등록된 이름과 일치해야 합니다.' }
  if (/주민|생년|identity|CF-13000/i.test(`${code} ${message}`)) return { title: '본인확인 정보 확인', action: '고객 직접 입력 링크에서 정보를 확인하세요. 같은 오류가 계속되면 상품별 identity 형식·암호화 스펙 확인이 필요합니다.' }
  if (/만료|완료된 요청|CF-00025/.test(`${code} ${message}`)) return { title: '인증 세션 종료', action: '먼저 최근 요청의 완료 여부를 확인하고, 필요하면 새 인증을 요청하세요.' }
  return { title: '조회 단계 확인 필요', action: '아래 최근 요청에서 진행 상태를 확인하세요. 개인정보 원문을 포함하지 않은 오류 코드로 담당자에게 문의하세요.' }
}
