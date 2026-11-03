/**
 * SJ — 건강기록 조회 결과 요약(순수 함수, 단독 테스트).
 *
 * 입력: CODEF 진료내역 result(기본 진료내역 + 세부 진료·치료 + 처방·조제 섹션).
 * 출력:
 *  - 연/월 그룹(날짜별 정리)
 *  - **상병(병명)별 추정 묶음**: 같은 병명(정규화 문자열 기준)으로 몇 번 방문했는지,
 *    어떤 수술/처치, 어떤 투약을 받았는지 — 날짜·기관 매칭으로 연결.
 *  - AI 전송용 **비식별 요약**(이름·주민번호 등 직접 식별자 제외).
 *
 * ⚠️ "추정": 세부/처방 섹션에는 병명이 없어 (진료일·기관) 일치로 연결한다.
 *    병명 표기가 다르면 같은 질환이라도 분리될 수 있고, 같은 날 다른 병명이면 치료/투약이
 *    복수 병명에 중복 연결될 수 있다(의학적 확정 아님 — 사람 확인 필요).
 */

export type Row = Record<string, unknown>

export interface HrSections {
  basic: Row[] // 기본 진료내역(병명 보유)
  detail: Row[] // 세부 진료·치료(수술/처치)
  prescribe: Row[] // 처방·조제(약품)
}

const BASIC_KEYS = ['resBasicTreatList', 'resTreatmentList', 'resBasicList', 'resList']
const DETAIL_KEYS = ['resDetailTreatList', 'resDetailList', 'resOperationList']
const PRESCRIBE_KEYS = ['resPrescribeDrugList', 'resPrescribeList', 'resDrugList', 'resMedicineList']

const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Row[]) : [])
const firstArr = (obj: Record<string, unknown>, keys: string[]): Row[] => {
  for (const k of keys) if (Array.isArray(obj[k])) return arr(obj[k])
  return []
}

/** result → 섹션 분류(기본/세부/처방). 최상위가 배열이면 전부 기본으로 본다. */
export function collectHrSections(result: unknown): HrSections {
  if (Array.isArray(result)) return { basic: arr(result), detail: [], prescribe: [] }
  if (!result || typeof result !== 'object') return { basic: [], detail: [], prescribe: [] }
  const obj = result as Record<string, unknown>
  return { basic: firstArr(obj, BASIC_KEYS), detail: firstArr(obj, DETAIL_KEYS), prescribe: firstArr(obj, PRESCRIBE_KEYS) }
}

// ── 값 도우미 ────────────────────────────────────────────────────────────────
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()
const digits = (v: unknown): string => s(v).replace(/[^\d]/g, '')
export const ymd8 = (v: unknown): string => (digits(v).length === 8 ? digits(v) : '')
export const num = (v: unknown): number => {
  const n = Number(s(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const field = (r: Row, keys: string[]): string => {
  for (const k of keys) {
    const v = s(r[k])
    if (v) return v
  }
  return ''
}

const DATE_KEYS = ['resTreatStartDate', 'resTreatDate', 'resDate', 'commStartDate']
const HOSP_KEYS = ['resHospitalName', 'resPharmacyName', 'resOrgName']
const DISEASE_KEYS = ['resDiseaseName', 'resSickName', 'resDisease']
const TYPE_KEYS = ['resTreatType', 'resType']
const PROC_KEYS = ['resOperationName', 'resSurgeryName', 'resCodeName', 'resTreatMeaning']
const DRUG_KEYS = ['resDrugName', 'resMedicineName']
const INGREDIENT_KEYS = ['resIngredients', 'resIngredient']
const DOSE_DAYS_KEYS = ['resTotalDosingdays', 'resPrescribeDays', 'resMedicationDays']

/** 병명 정규화(추정 묶음 키): 공백 압축 + 괄호 코드 제거. 과한 병합은 하지 않는다(보수적). */
export function normalizeDisease(name: string): string {
  return s(name)
    .replace(/\([^)]*\)/g, '') // (코드) 제거
    .replace(/\s+/g, ' ')
    .trim()
}

/** 수술로 보이는 처치명인지(이름 기반 추정 — 표시용 플래그, 의학적 확정 아님). */
const SURGERY_RE = /(수술|절제|적출|성형|이식|봉합|절개|내시경.?적.?절제|관혈|정복|고정)/
export function looksSurgery(name: string, type: string): boolean {
  return SURGERY_RE.test(name) || /수술/.test(type)
}

// ── 그룹(연/월) ──────────────────────────────────────────────────────────────
export type GroupBy = 'year' | 'month'
export const groupKeyOf = (ymd: string, by: GroupBy): string => {
  if (ymd.length < 6) return '날짜미상'
  return by === 'year' ? ymd.slice(0, 4) : `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}`
}

export interface DatedGroup<T> {
  key: string // '2026' 또는 '2026.09'
  items: T[]
}
/** 날짜 필드로 연/월 그룹(내림차순). */
export function groupByDate<T>(rows: T[], dateOf: (r: T) => string, by: GroupBy): DatedGroup<T>[] {
  const sorted = [...rows].sort((a, b) => Number(dateOf(b) || 0) - Number(dateOf(a) || 0))
  const map = new Map<string, T[]>()
  for (const r of sorted) {
    const k = groupKeyOf(dateOf(r), by)
    const list = map.get(k) ?? []
    list.push(r)
    map.set(k, list)
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, items }))
}

// ── 상병별 추정 묶음 ──────────────────────────────────────────────────────────
export interface SurgeryItem {
  name: string
  date: string // YYYYMMDD
  hospital: string
  isSurgery: boolean
}
export interface MedItem {
  name: string
  ingredient: string
  date: string
  hospital: string
  days: number
}
export interface DiseaseSummary {
  disease: string // 정규화 표시명
  visitCount: number // 방문(진료일·기관 조합) 수
  recordCount: number // 기본 진료 레코드 수
  firstDate: string // YYYYMMDD
  lastDate: string
  hospitals: string[]
  departments: string[]
  surgeries: SurgeryItem[] // 날짜·기관 매칭(추정)
  medications: MedItem[] // 날짜·기관 매칭(추정)
  selfPayTotal: number // 본인부담 합(해당 병명 기본 레코드)
}

const visitKey = (date: string, hospital: string): string => `${date}|${hospital}`

/**
 * 상병별 추정 묶음. basic 레코드의 (병명)별로 방문/병원/금액을 집계하고,
 * detail/prescribe 를 (진료일·기관) 일치로 연결한다.
 */
export function summarizeByDisease(sections: HrSections): DiseaseSummary[] {
  // 1) (날짜|기관) → 세부/처방 인덱스
  const surgeryByVisit = new Map<string, SurgeryItem[]>()
  for (const r of sections.detail) {
    const date = ymd8(field(r, DATE_KEYS))
    const hospital = field(r, HOSP_KEYS)
    if (!date && !hospital) continue
    const name = field(r, PROC_KEYS)
    const type = field(r, TYPE_KEYS)
    if (!name && !type) continue
    const key = visitKey(date, hospital)
    const list = surgeryByVisit.get(key) ?? []
    list.push({ name: name || type, date, hospital, isSurgery: looksSurgery(name, type) })
    surgeryByVisit.set(key, list)
  }
  const medByVisit = new Map<string, MedItem[]>()
  for (const r of sections.prescribe) {
    const date = ymd8(field(r, DATE_KEYS))
    const hospital = field(r, HOSP_KEYS)
    const name = field(r, DRUG_KEYS)
    if (!name) continue
    const key = visitKey(date, hospital)
    const list = medByVisit.get(key) ?? []
    list.push({ name, ingredient: field(r, INGREDIENT_KEYS), date, hospital, days: num(r[DOSE_DAYS_KEYS.find((k) => r[k] != null) ?? '']) })
    medByVisit.set(key, list)
  }

  // 2) 병명별 집계
  interface Acc {
    disease: string
    visits: Set<string>
    recordCount: number
    hospitals: Set<string>
    departments: Set<string>
    first: string
    last: string
    selfPay: number
  }
  const groups = new Map<string, Acc>()
  for (const r of sections.basic) {
    const diseaseRaw = field(r, DISEASE_KEYS)
    if (!diseaseRaw) continue // 병명 없는 기본 레코드는 상병 요약에서 제외
    const disease = normalizeDisease(diseaseRaw)
    const date = ymd8(field(r, DATE_KEYS))
    const hospital = field(r, HOSP_KEYS)
    const dept = field(r, ['resDepartment', 'resDept'])
    const g = groups.get(disease) ?? { disease, visits: new Set(), recordCount: 0, hospitals: new Set(), departments: new Set(), first: '', last: '', selfPay: 0 }
    g.recordCount += 1
    if (date || hospital) g.visits.add(visitKey(date, hospital))
    if (hospital) g.hospitals.add(hospital)
    if (dept) g.departments.add(dept)
    if (date) {
      if (!g.first || date < g.first) g.first = date
      if (!g.last || date > g.last) g.last = date
    }
    g.selfPay += num(r.resDeductibleAmt ?? r.resSelfPay)
    groups.set(disease, g)
  }

  // 3) 세부/처방 연결 + 정리
  const dedupe = <T>(items: T[], keyOf: (t: T) => string): T[] => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const it of items) {
      const k = keyOf(it)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(it)
    }
    return out
  }

  const result: DiseaseSummary[] = []
  for (const g of groups.values()) {
    const surgeries: SurgeryItem[] = []
    const meds: MedItem[] = []
    for (const vk of g.visits) {
      for (const it of surgeryByVisit.get(vk) ?? []) surgeries.push(it)
      for (const it of medByVisit.get(vk) ?? []) meds.push(it)
    }
    result.push({
      disease: g.disease,
      visitCount: g.visits.size,
      recordCount: g.recordCount,
      firstDate: g.first,
      lastDate: g.last,
      hospitals: Array.from(g.hospitals),
      departments: Array.from(g.departments),
      surgeries: dedupe(surgeries, (x) => `${x.date}|${x.hospital}|${x.name}`),
      medications: dedupe(meds, (x) => `${x.date}|${x.hospital}|${x.name}`),
      selfPayTotal: g.selfPay
    })
  }
  // 방문 많은 순 → 최근 순
  result.sort((a, b) => b.visitCount - a.visitCount || Number(b.lastDate || 0) - Number(a.lastDate || 0))
  return result
}

// ── AI 전송용 비식별 요약 ─────────────────────────────────────────────────────
export interface HrAiSummary {
  periodFrom: string // YYYY.MM.DD
  periodTo: string
  totalVisits: number
  diseases: Array<{ name: string; visits: number; departments: string[]; surgeries: string[]; medications: string[] }>
  note: string
}

const dot = (ymd: string): string => (ymd.length === 8 ? `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}` : '')

/** 이름·주민번호 등 직접 식별자를 제외한 구조화 요약(AI 입력용). */
export function buildHrAiSummary(sections: HrSections, opts?: { maxDiseases?: number; maxItems?: number }): HrAiSummary {
  const maxD = opts?.maxDiseases ?? 25
  const maxI = opts?.maxItems ?? 12
  const diseases = summarizeByDisease(sections)
  const dates = sections.basic.map((r) => ymd8(field(r, DATE_KEYS))).filter(Boolean).sort()
  const visitSet = new Set<string>()
  for (const r of sections.basic) visitSet.add(visitKey(ymd8(field(r, DATE_KEYS)), field(r, HOSP_KEYS)))
  return {
    periodFrom: dates.length ? dot(dates[0]) : '',
    periodTo: dates.length ? dot(dates[dates.length - 1]) : '',
    totalVisits: visitSet.size,
    diseases: diseases.slice(0, maxD).map((d) => ({
      name: d.disease,
      visits: d.visitCount,
      departments: d.departments.slice(0, 5),
      surgeries: d.surgeries.filter((x) => x.isSurgery).map((x) => x.name).slice(0, maxI),
      medications: Array.from(new Set(d.medications.map((m) => m.name))).slice(0, maxI)
    })),
    note: '병명 문자열·(진료일·기관) 매칭 기반 추정 요약. 이름·주민번호 등 식별자는 제외됨. 의학적 확정 아님.'
  }
}
