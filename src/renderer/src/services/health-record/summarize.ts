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
export type PartGroup =
  | 'spine' | 'knee' | 'shoulder' | 'hip' | 'foot' | 'hand'
  | 'abdomen' | 'heart' | 'chest' | 'brain' | 'eye' | 'ent' | 'dental'
  | 'skin' | 'uro' | 'ob' | 'breast' | 'other'

export interface SurgeryItem {
  name: string
  date: string // YYYYMMDD
  hospital: string
  isSurgery: boolean
  bodyPart: string // 추정 부위(표시명) — 예: '척추(요추)'
  partGroup: PartGroup // 아이콘/분류용
}

/** 수술/처치명에서 **부위**를 추정(이름 기반, 확정 아님). 더 구체적인 규칙이 먼저. */
const PART_RULES: { re: RegExp; part: string; group: PartGroup }[] = [
  { re: /(경추|목디스크)/, part: '척추(경추)', group: 'spine' },
  { re: /(흉추)/, part: '척추(흉추)', group: 'spine' },
  { re: /(요추|추간판|디스크|척추|척추관)/, part: '척추(요추)', group: 'spine' },
  { re: /(슬관절|무릎|반월상|십자인대|슬개)/, part: '무릎(슬관절)', group: 'knee' },
  { re: /(견관절|어깨|회전근개|극상근)/, part: '어깨(견관절)', group: 'shoulder' },
  { re: /(고관절|둔부|대퇴골두)/, part: '고관절', group: 'hip' },
  { re: /(족부|발목|족지|중족골|아킬레스|족저)/, part: '발·발목', group: 'foot' },
  { re: /(수부|손목|수지|손가락|수근)/, part: '손·손목', group: 'hand' },
  { re: /(담낭|쓸개)/, part: '담낭', group: 'abdomen' },
  { re: /(충수|맹장)/, part: '충수(맹장)', group: 'abdomen' },
  { re: /(위절제|위아전|위전절|위암|^위 |위내시경)/, part: '위', group: 'abdomen' },
  { re: /(대장|결장|직장|에스상)/, part: '대장', group: 'abdomen' },
  { re: /(간절제|간엽|간암|간이식)/, part: '간', group: 'abdomen' },
  { re: /(신장|콩팥|신우)/, part: '신장', group: 'abdomen' },
  { re: /(탈장|서혜부|제대)/, part: '탈장', group: 'abdomen' },
  { re: /(치핵|치질|항문)/, part: '항문', group: 'abdomen' },
  { re: /(관상동맥|심장|심혈관|판막|스텐트|관동맥)/, part: '심장', group: 'heart' },
  { re: /(폐|흉부|기흉|늑막)/, part: '폐·흉부', group: 'chest' },
  { re: /(유방|유선)/, part: '유방', group: 'breast' },
  { re: /(뇌|두개|지주막|경막)/, part: '뇌', group: 'brain' },
  { re: /(백내장|수정체|망막|녹내장|각막|안검|눈)/, part: '눈', group: 'eye' },
  { re: /(부비동|비중격|코|편도|인두|후두|갑상선|고막|중이|이개)/, part: '이비인후·갑상선', group: 'ent' },
  { re: /(치아|치과|임플란트|발치|치근|잇몸)/, part: '치아', group: 'dental' },
  { re: /(전립선|방광|요관|요도|정관|음경|고환)/, part: '비뇨', group: 'uro' },
  { re: /(자궁|난소|제왕|질|난관)/, part: '자궁·난소', group: 'ob' },
  { re: /(피부|병변|낭종|지방종|사마귀|모반|열상|봉합)/, part: '피부·연부조직', group: 'skin' }
]

export function classifySurgery(name: string): { part: string; group: PartGroup } {
  const n = s(name)
  for (const rule of PART_RULES) if (rule.re.test(n)) return { part: rule.part, group: rule.group }
  return { part: '', group: 'other' }
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
  inpatientVisits: number // 입원 방문 수
  outpatientVisits: number // 통원(외래/요양) 방문 수
  recordCount: number // 기본 진료 레코드 수
  firstDate: string // YYYYMMDD
  lastDate: string
  hospitals: string[]
  departments: string[]
  surgeries: SurgeryItem[] // 날짜·기관 매칭(추정)
  medications: MedItem[] // 날짜·기관 매칭(추정)
  selfPayTotal: number // 본인부담 합(해당 병명 기본 레코드)
}

/** 입원 여부(진료형태 문자열 기준). */
const isInpatientType = (treatType: string): boolean => /입원/.test(treatType)

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
    const label = name || type
    const cls = classifySurgery(label)
    list.push({ name: label, date, hospital, isSurgery: looksSurgery(name, type), bodyPart: cls.part, partGroup: cls.group })
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
    inpatient: Set<string>
    outpatient: Set<string>
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
    const g = groups.get(disease) ?? { disease, visits: new Set(), inpatient: new Set(), outpatient: new Set(), recordCount: 0, hospitals: new Set(), departments: new Set(), first: '', last: '', selfPay: 0 }
    g.recordCount += 1
    const vk = visitKey(date, hospital)
    if (date || hospital) {
      g.visits.add(vk)
      if (isInpatientType(field(r, TYPE_KEYS))) g.inpatient.add(vk)
      else g.outpatient.add(vk)
    }
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
    // 입원이면서 외래로도 잡힌 방문은 입원 우선(중복 제거).
    const outpatientOnly = new Set(Array.from(g.outpatient).filter((k) => !g.inpatient.has(k)))
    result.push({
      disease: g.disease,
      visitCount: g.visits.size,
      inpatientVisits: g.inpatient.size,
      outpatientVisits: outpatientOnly.size,
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

// ── 하이라이트(보험 상담 주목 신호) ─────────────────────────────────────────
/** 통원(외래) '잦은 방문' 임계 — 상병별 외래 방문 수. */
export const FREQUENT_VISIT_THRESHOLD = 7
/** 고액 본인부담 임계(상병 합계). */
export const BIG_SELFPAY_THRESHOLD = 300000

export interface HrHighlights {
  inpatientVisits: number // 전체 입원 방문 수
  surgeryCount: number // 수술 항목 수(추정)
  frequentOutpatient: DiseaseSummary[] // 통원 N회 이상 상병
  bigSelfPay: DiseaseSummary[] // 고액 본인부담 상병
  hasAny: boolean
}

export function buildHighlights(sections: HrSections): HrHighlights {
  const diseases = summarizeByDisease(sections)
  const inpatientVisits = diseases.reduce((s, d) => s + d.inpatientVisits, 0)
  const surgeryCount = diseases.reduce((s, d) => s + d.surgeries.filter((x) => x.isSurgery).length, 0)
  const frequentOutpatient = diseases.filter((d) => d.outpatientVisits >= FREQUENT_VISIT_THRESHOLD)
  const bigSelfPay = diseases.filter((d) => d.selfPayTotal >= BIG_SELFPAY_THRESHOLD).sort((a, b) => b.selfPayTotal - a.selfPayTotal).slice(0, 3)
  return { inpatientVisits, surgeryCount, frequentOutpatient, bigSelfPay, hasAny: inpatientVisits > 0 || surgeryCount > 0 || frequentOutpatient.length > 0 || bigSelfPay.length > 0 }
}

/** 상병 카드 강조 사유 배지(없으면 빈 배열). */
export function diseaseFlags(d: DiseaseSummary): string[] {
  const f: string[] = []
  if (d.inpatientVisits > 0) f.push(`입원 ${d.inpatientVisits}`)
  if (d.surgeries.some((x) => x.isSurgery)) f.push(`수술 ${d.surgeries.filter((x) => x.isSurgery).length}`)
  if (d.outpatientVisits >= FREQUENT_VISIT_THRESHOLD) f.push(`통원 ${d.outpatientVisits}회`)
  if (d.selfPayTotal >= BIG_SELFPAY_THRESHOLD) f.push('고액')
  return f
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
      surgeries: d.surgeries.filter((x) => x.isSurgery).map((x) => (x.bodyPart ? `${x.bodyPart} · ${x.name}` : x.name)).slice(0, maxI),
      medications: Array.from(new Set(d.medications.map((m) => m.name))).slice(0, maxI)
    })),
    note: '병명 문자열·(진료일·기관) 매칭 기반 추정 요약. 이름·주민번호 등 식별자는 제외됨. 의학적 확정 아님.'
  }
}
