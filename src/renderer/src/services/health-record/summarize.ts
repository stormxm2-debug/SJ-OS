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

/** 수술이 아닌 단순 처치/부수 항목(수술보다 먼저 걸러낸다 — 석고고정·도수정복 등 오탐 방지). */
const NON_SURGERY_RE =
  /(석고|깁스|부목|붕대|견인|도수|물리치료|재활|운동치료|드레싱|소독|주사|주입|수액|수혈|채혈|검사|촬영|초음파|방사선단순|상담|교육|처치|관찰|경과|마취|재료|밴드|발사|실밥|봉합사\s*제거|스케일링|세척|팩|찜질)/
/** 수술로 보이는 처치명인지(이름 기반 추정 — 표시용 플래그, 의학적 확정 아님). 단순 처치는 먼저 제외. */
const SURGERY_RE = /(수술|절제|적출|성형|이식|봉합|절개|내시경.?적.?절제|관혈|정복|고정|재건|치환|문합|우회|색전|유합|제거술|교정술|확장술)/
export function looksSurgery(name: string, type: string): boolean {
  const n = s(name)
  if (NON_SURGERY_RE.test(n)) return false
  return SURGERY_RE.test(n) || /수술/.test(type)
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
  { re: /(족부|발목|족관절|족지|발가락|중족골|아킬레스|족저|거골|복사뼈|비골하단|경골하단)/, part: '발·발목', group: 'foot' },
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

/**
 * 단순 처치(수술 아님) 여부 — 물리치료·주사·드레싱·검사 등. 표시에서 '수술'과 구분한다.
 * SURGERY_RE 로 수술로 잡힌 건 수술 우선(여기서 제외하지 않음).
 */
const TRIVIAL_PROC_RE =
  /(물리치료|도수치료|재활|운동치료|주사|주입|수액|수혈|드레싱|소독|처치료|단순처치|채혈|검사|촬영|초음파|방사선단순|상담|교육|투약|조제|관찰|경과)/
export function isTrivialProcedure(name: string, type = ''): boolean {
  const n = s(name)
  if (looksSurgery(n, type)) return false
  return TRIVIAL_PROC_RE.test(n)
}

/** 부위별 후유장해 '가능성'(일반 참고) + 보험 상담 확인 포인트. 의학적·보험적 확정 아님. */
export interface PartSequelae {
  risks: string[] // 일반적으로 거론되는 후유장해 유형(추정)
  insurancePoint: string // 보험 상담 시 확인 포인트(약관 후유장해분류표 기준)
}
export const SEQUELAE_BY_PART: Record<PartGroup, PartSequelae> = {
  spine: { risks: ['신경 증상(다리 저림·방사통·근력 저하)', '척추 운동범위 제한·강직', '유합술 후 인접 분절 퇴행'], insurancePoint: '약관 후유장해분류표의 "척추(등뼈·허리뼈) 장해"(운동장해·기형장해) 지급률 확인' },
  knee: { risks: ['무릎 관절 운동범위 제한', '관절 불안정·연골 손상 후유증', '재발·재수술 가능'], insurancePoint: '하지 3대 관절(무릎) "관절 기능장해" 지급률 확인' },
  shoulder: { risks: ['어깨 운동범위 제한', '근력 약화·재파열'], insurancePoint: '상지 3대 관절(어깨) 기능장해 지급률 확인' },
  hip: { risks: ['보행 장해·파행', '인공관절 치환 시 기능장해', '다리 길이 차이'], insurancePoint: '하지 관절(고관절)·인공관절 관련 기능장해 지급률 확인' },
  foot: { risks: ['족부 변형·보행 통증', '발가락 강직·결손 시 기능 저하'], insurancePoint: '발가락·발목 기능/결손 장해 지급률 확인' },
  hand: { risks: ['손가락 강직·결손', '파악력(쥐는 힘) 저하'], insurancePoint: '손가락 결손·기능장해(세분 지급률) 확인' },
  abdomen: { risks: ['장유착·장폐색 가능', '장기 절제 시 소화·대사 기능 변화', '수술 흉터'], insurancePoint: '복부 장기(비장·신장 등) 결손/기능장해·흉터(추상) 확인' },
  heart: { risks: ['심기능 저하·부정맥', '재협착·재시술 가능'], insurancePoint: '심장(흉복부 장기) 기능장해 지급률 확인' },
  chest: { risks: ['폐기능 저하·호흡 곤란', '흉막 유착'], insurancePoint: '호흡기(폐) 기능장해 지급률 확인' },
  brain: { risks: ['인지·언어·운동 신경학적 후유증', '간질 발작 가능', '마비'], insurancePoint: '신경계(뇌) 장해(정신·신경 분류)는 지급률이 높을 수 있어 특히 확인' },
  eye: { risks: ['시력 저하·시야 결손', '복시·안구 운동 장해'], insurancePoint: '눈(시력·시야·조절·운동) 장해 지급률 확인' },
  ent: { risks: ['청력 저하', '후각·발성 변화', '갑상선 수술 시 호르몬·목소리 변화'], insurancePoint: '귀(청력)·코·씹고 말하는 장해, 갑상선 기능 확인' },
  dental: { risks: ['저작(씹기) 기능 저하', '치아 결손'], insurancePoint: '씹거나 말하는 장해·치아 보철 관련 담보 확인' },
  skin: { risks: ['흉터(추상)·구축', '감각 저하'], insurancePoint: '외모 추상장해(흉터) 지급률 확인' },
  uro: { risks: ['배뇨 기능 변화·요실금', '생식·성 기능 변화'], insurancePoint: '비뇨·생식기 장해 지급률 확인' },
  ob: { risks: ['생식 기능 변화', '골반 장기 유착'], insurancePoint: '생식기 장해·관련 담보 확인' },
  breast: { risks: ['림프부종(겨드랑이 절제 범위에 따라)', '감각 저하·흉터'], insurancePoint: '외모 추상(흉터)·유방 관련 담보 확인' },
  other: { risks: ['수술 부위 통증·반흔', '해당 부위 기능 저하 가능'], insurancePoint: '해당 부위 약관 후유장해분류표 확인' }
}
export function sequelaeFor(group: PartGroup): PartSequelae {
  return SEQUELAE_BY_PART[group] ?? SEQUELAE_BY_PART.other
}

/** 특정 수술명(패턴)별 세부 후유장해(일반 참고). 더 구체적인 규칙이 먼저. 매칭 없으면 부위(group) 기준. */
const SURGERY_SEQUELAE_RULES: { re: RegExp; label: string; seq: PartSequelae }[] = [
  { re: /(요추|경추|흉추|척추|추간판).*(고정|유합|나사|기기|핀)|척추고정|척추유합/, label: '척추 고정·유합술', seq: { risks: ['신경근 증상 잔존(저림·방사통·근력 저하)', '인접 분절 퇴행·재수술 가능', '척추 운동범위 제한'], insurancePoint: '후유장해분류표 "척추의 운동장해·기형장해" 지급률 확인(지급률 높을 수 있음)' } },
  { re: /(추간판|디스크).*(절제|제거|감압|성형)|수핵|레이저.*디스크|내시경.*디스크/, label: '디스크 절제·감압술', seq: { risks: ['재발성 디스크·잔존 통증', '신경 증상(저림·근력 저하)'], insurancePoint: '척추 장해 여부 + 수술 담보(수술비) 확인' } },
  { re: /(반월상|반월판|연골판)/, label: '무릎 반월상연골 수술', seq: { risks: ['무릎 운동범위 제한', '퇴행성 관절염 가속', '재파열·재수술'], insurancePoint: '하지(무릎) 관절 기능장해 지급률 확인' } },
  { re: /십자인대/, label: '십자인대 재건술', seq: { risks: ['무릎 불안정성', '운동범위 제한', '재건 실패·재수술'], insurancePoint: '하지(무릎) 관절 기능장해 지급률 확인' } },
  { re: /(인공관절|관절성형|치환)/, label: '인공관절 치환술', seq: { risks: ['치환부 기능 제한', '감염·마모·재치환', '다리 길이 차이'], insurancePoint: '해당 관절 기능장해 + 인공관절 치환 관련 지급률 확인' } },
  { re: /(회전근개|극상근|어깨.*봉합)/, label: '회전근개 봉합술', seq: { risks: ['어깨 근력 약화·재파열', '운동범위 제한'], insurancePoint: '상지(어깨) 관절 기능장해 지급률 확인' } },
  { re: /아킬레스/, label: '아킬레스건 봉합·재건', seq: { risks: ['발목 저굴력(발끝 힘) 약화', '재파열', '보행 변화'], insurancePoint: '발목 관절 기능장해 지급률 확인' } },
  { re: /(족관절|발목|거골|외과|내과골|비골).*(골절|인대|고정|정복|재건)|발목.*수술|족관절/, label: '발목(족관절) 수술', seq: { risks: ['발목 운동범위 제한', '외상성 관절염', '금속 제거 등 추가 수술'], insurancePoint: '발목 관절 기능장해 + 골절 후유증·수술 담보 확인' } },
  { re: /(담낭|쓸개)/, label: '담낭 절제술', seq: { risks: ['소화 불량·지방변', '담관 손상(드묾)', '수술 흉터'], insurancePoint: '복부 장기 결손/흉터(추상) 담보 확인' } },
  { re: /(충수|맹장)/, label: '충수 절제술', seq: { risks: ['장유착·장폐색(드묾)', '수술 흉터'], insurancePoint: '복부 수술 흉터·담보 확인' } },
  { re: /(탈장|서혜부|제대)/, label: '탈장 수술', seq: { risks: ['재발', '만성 통증·이물감'], insurancePoint: '복부 수술·흉터 담보 확인' } },
  { re: /(백내장|수정체)/, label: '백내장 수술', seq: { risks: ['잔여 굴절 이상', '후발 백내장', '안구건조·눈부심'], insurancePoint: '눈(교정시력 기준) 시력 장해 확인' } },
  { re: /갑상선/, label: '갑상선 수술', seq: { risks: ['갑상선호르몬 저하(평생 복용 가능)', '목소리 변화(성대신경)', '부갑상선 기능 저하'], insurancePoint: '내분비·발성 장해 + 갑상선 관련 담보 확인' } },
  { re: /(유방|유선)/, label: '유방 수술', seq: { risks: ['림프부종(겨드랑이 절제 범위에 따라)', '감각 저하', '흉터·외형 변화'], insurancePoint: '외모 추상(흉터)·유방 관련 담보 확인' } },
  { re: /(관상동맥|관동맥|스텐트|스탠트|우회)/, label: '관상동맥 중재·우회', seq: { risks: ['재협착·재시술', '심기능 저하', '항혈전제 복용(출혈 위험)'], insurancePoint: '심장 기능장해 + 중대한 수술 담보 확인' } },
  { re: /(뇌|두개|지주막|경막|동맥류)/, label: '뇌 수술', seq: { risks: ['신경학적 후유증(마비·인지·언어)', '간질 발작', '재출혈'], insurancePoint: '신경계(뇌) 장해 — 지급률이 높을 수 있어 특히 확인' } },
  { re: /(자궁|난소|제왕|난관)/, label: '자궁·난소 수술', seq: { risks: ['생식 기능 변화', '골반 장기 유착', '호르몬 변화'], insurancePoint: '생식기 장해·관련 담보 확인' } },
  { re: /(전립선|방광|요관|요도)/, label: '비뇨기 수술', seq: { risks: ['배뇨 기능 변화·요실금', '성 기능 변화'], insurancePoint: '비뇨·생식기 장해 지급률 확인' } }
]

/** 수술명이 특정 세부 규칙에 매칭되는지(대표 수술명 선정용). */
export function matchesSpecificSurgery(name: string): boolean {
  const n = s(name)
  return SURGERY_SEQUELAE_RULES.some((r) => r.re.test(n))
}
/** 수술명(+부위) → 후유장해. 특정 수술명 매칭 우선, 없으면 부위 기준. label 은 매칭된 수술 유형명. */
export function sequelaeForSurgery(name: string, group: PartGroup): { label?: string; seq: PartSequelae } {
  const n = s(name)
  for (const r of SURGERY_SEQUELAE_RULES) if (r.re.test(n)) return { label: r.label, seq: r.seq }
  return { seq: sequelaeFor(group) }
}

/** 수술 '시행 1회' 단위(같은 진료일·기관의 수술 라인아이템을 하나로 묶음). */
export interface SurgeryOccasion {
  date: string
  hospital: string
  partGroup: PartGroup // 대표 부위
  bodyPart: string
  names: string[] // 그 날 수술명(중복 제거)
  primaryName: string // 대표 수술명(후유장해·헤더용)
}
/**
 * 수술 항목들을 '시행 1회' 단위로 묶는다 — 한 번의 수술이 세부내역에 여러 줄로
 * 들어와도 (진료일·기관)이 같으면 1회로 집계. 수술로 보이는 항목(isSurgery)만 대상.
 */
export function groupSurgeryOccasions(items: SurgeryItem[]): SurgeryOccasion[] {
  const byVisit = new Map<string, SurgeryItem[]>()
  for (const it of items) {
    if (!it.isSurgery) continue
    const k = visitKey(it.date, it.hospital)
    const list = byVisit.get(k) ?? []
    list.push(it)
    byVisit.set(k, list)
  }
  const out: SurgeryOccasion[] = []
  for (const list of byVisit.values()) {
    const names = Array.from(new Set(list.map((x) => x.name).filter(Boolean)))
    const repItem = list.find((x) => x.partGroup !== 'other') ?? list[0]
    const primaryName =
      names.find((nm) => matchesSpecificSurgery(nm)) ??
      names.slice().sort((a, b) => b.length - a.length)[0] ??
      list[0].name
    out.push({ date: list[0].date, hospital: list[0].hospital, partGroup: repItem.partGroup, bodyPart: repItem.bodyPart, names, primaryName })
  }
  out.sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
  return out
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

// ── 에피소드 묶음(같은 병명 + 비슷한 시기) ───────────────────────────────────
/** YYYYMMDD → UTC ms(정렬/간격용). 형식오류면 NaN. */
const toUtc = (ymd: string): number => {
  if (ymd.length !== 8) return NaN
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)))
}
/** 두 날짜(YYYYMMDD) 사이 일수(절대값). 하나라도 형식오류면 Infinity(=끊김). */
const dayGap = (a: string, b: string): number => {
  const da = toUtc(a)
  const db = toUtc(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity
  return Math.abs(db - da) / 86400000
}

/** 공통 dedupe(키 기준 첫 항목 유지). */
function dedupeBy<T>(items: T[], keyOf: (t: T) => string): T[] {
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

export interface EpisodeVisit {
  date: string // YYYYMMDD
  hospital: string
  dept: string
  type: string
  inpatient: boolean
  selfPay: number
}
export interface DiseaseEpisode {
  disease: string // 정규화 표시명
  firstDate: string // YYYYMMDD
  lastDate: string
  visitCount: number // (진료일·기관) 방문 수
  recordCount: number
  inpatient: boolean // 에피소드 내 입원 포함
  hospitals: string[]
  departments: string[]
  visits: EpisodeVisit[] // 날짜 오름차순
  surgeries: SurgeryItem[] // (진료일·기관) 매칭(추정)
  medications: MedItem[] // (진료일·기관) 매칭(추정)
  selfPayTotal: number
}

/** 같은 병명 안에서 '같은 에피소드'로 볼 최대 날짜 간격(일). */
export const EPISODE_GAP_DAYS = 30

interface VisitAcc {
  date: string
  hospital: string
  dept: string
  type: string
  selfPay: number
  recordCount: number
}

function buildEpisode(
  disease: string,
  visits: VisitAcc[],
  surgeryByVisit: Map<string, SurgeryItem[]>,
  medByVisit: Map<string, MedItem[]>
): DiseaseEpisode {
  const dates = visits.map((v) => v.date).filter(Boolean).sort()
  const surgeries: SurgeryItem[] = []
  const meds: MedItem[] = []
  for (const v of visits) {
    const vk = visitKey(v.date, v.hospital)
    for (const it of surgeryByVisit.get(vk) ?? []) surgeries.push(it)
    for (const it of medByVisit.get(vk) ?? []) meds.push(it)
  }
  return {
    disease,
    firstDate: dates[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    visitCount: visits.length,
    recordCount: visits.reduce((s, v) => s + v.recordCount, 0),
    inpatient: visits.some((v) => isInpatientType(v.type)),
    hospitals: Array.from(new Set(visits.map((v) => v.hospital).filter(Boolean))),
    departments: Array.from(new Set(visits.map((v) => v.dept).filter(Boolean))),
    visits: visits
      .map((v) => ({ date: v.date, hospital: v.hospital, dept: v.dept, type: v.type, inpatient: isInpatientType(v.type), selfPay: v.selfPay }))
      .sort((a, b) => Number(a.date || 0) - Number(b.date || 0)),
    surgeries: dedupeBy(surgeries, (x) => `${x.date}|${x.hospital}|${x.name}`),
    medications: dedupeBy(meds, (x) => `${x.date}|${x.hospital}|${x.name}`),
    selfPayTotal: visits.reduce((s, v) => s + v.selfPay, 0)
  }
}

/**
 * **같은 병명 + 비슷한 시기**로 진료를 '에피소드'로 묶는다.
 * 같은 병명 안에서 (진료일·기관) 방문을 날짜순으로 정렬하고, 연속 방문 간격이
 * gapDays 를 넘으면 새 에피소드로 분리한다(한 번의 치료 묶음 단위).
 * 수술/투약은 (진료일·기관) 일치로 연결(추정, 의학적 확정 아님).
 */
export function summarizeEpisodes(sections: HrSections, gapDays = EPISODE_GAP_DAYS): DiseaseEpisode[] {
  // (날짜|기관) → 세부/처방 인덱스 (summarizeByDisease 와 동일 방식)
  const surgeryByVisit = new Map<string, SurgeryItem[]>()
  for (const r of sections.detail) {
    const date = ymd8(field(r, DATE_KEYS))
    const hospital = field(r, HOSP_KEYS)
    if (!date && !hospital) continue
    const name = field(r, PROC_KEYS)
    const type = field(r, TYPE_KEYS)
    if (!name && !type) continue
    const label = name || type
    const cls = classifySurgery(label)
    const key = visitKey(date, hospital)
    const list = surgeryByVisit.get(key) ?? []
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

  // 병명 → (날짜|기관) 방문 누적
  const byDisease = new Map<string, Map<string, VisitAcc>>()
  for (const r of sections.basic) {
    const diseaseRaw = field(r, DISEASE_KEYS)
    if (!diseaseRaw) continue
    const disease = normalizeDisease(diseaseRaw)
    const date = ymd8(field(r, DATE_KEYS))
    const hospital = field(r, HOSP_KEYS)
    if (!date && !hospital) continue
    const dept = field(r, ['resDepartment', 'resDept'])
    const type = field(r, TYPE_KEYS)
    const selfPay = num(r.resDeductibleAmt ?? r.resSelfPay)
    const vk = visitKey(date, hospital)
    const vmap = byDisease.get(disease) ?? new Map<string, VisitAcc>()
    const v = vmap.get(vk) ?? { date, hospital, dept, type, selfPay: 0, recordCount: 0 }
    v.selfPay += selfPay
    v.recordCount += 1
    if (!v.dept && dept) v.dept = dept
    if (isInpatientType(type)) v.type = type // 입원 표기 우선
    else if (!v.type && type) v.type = type
    vmap.set(vk, v)
    byDisease.set(disease, vmap)
  }

  const episodes: DiseaseEpisode[] = []
  for (const [disease, vmap] of byDisease) {
    const all = Array.from(vmap.values())
    const dated = all.filter((v) => v.date).sort((a, b) => Number(a.date) - Number(b.date))
    const undated = all.filter((v) => !v.date)
    let current: VisitAcc[] = []
    let prev = ''
    for (const v of dated) {
      if (current.length && dayGap(prev, v.date) > gapDays) {
        episodes.push(buildEpisode(disease, current, surgeryByVisit, medByVisit))
        current = []
      }
      current.push(v)
      prev = v.date
    }
    if (current.length) episodes.push(buildEpisode(disease, current, surgeryByVisit, medByVisit))
    if (undated.length) episodes.push(buildEpisode(disease, undated, surgeryByVisit, medByVisit))
  }
  // 최근 에피소드 먼저 → 방문 많은 순
  episodes.sort((a, b) => Number(b.lastDate || 0) - Number(a.lastDate || 0) || b.visitCount - a.visitCount)
  return episodes
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
  // 수술 '건수'는 항목 수가 아니라 **수술 시행 1회(진료일·기관)** 단위로 센다(한 수술이 여러 줄로 쪼개진 과다집계 방지).
  const surgeryVisits = new Set<string>()
  for (const r of sections.detail) {
    if (looksSurgery(field(r, PROC_KEYS), field(r, TYPE_KEYS))) surgeryVisits.add(visitKey(ymd8(field(r, DATE_KEYS)), field(r, HOSP_KEYS)))
  }
  const surgeryCount = surgeryVisits.size
  const frequentOutpatient = diseases.filter((d) => d.outpatientVisits >= FREQUENT_VISIT_THRESHOLD)
  const bigSelfPay = diseases.filter((d) => d.selfPayTotal >= BIG_SELFPAY_THRESHOLD).sort((a, b) => b.selfPayTotal - a.selfPayTotal).slice(0, 3)
  return { inpatientVisits, surgeryCount, frequentOutpatient, bigSelfPay, hasAny: inpatientVisits > 0 || surgeryCount > 0 || frequentOutpatient.length > 0 || bigSelfPay.length > 0 }
}

/** 상병 카드 강조 사유 배지(없으면 빈 배열). */
export function diseaseFlags(d: DiseaseSummary): string[] {
  const f: string[] = []
  if (d.inpatientVisits > 0) f.push(`입원 ${d.inpatientVisits}`)
  const surgN = groupSurgeryOccasions(d.surgeries).length
  if (surgN > 0) f.push(`수술 ${surgN}`)
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
