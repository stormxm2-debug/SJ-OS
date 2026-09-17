import { documentLines, type PageItems } from './proposalParser'

/**
 * 가입제안서 담보 정리 — 제안서에서 뽑은 담보를 고객 엑셀 양식 항목으로 분류하고,
 * 상황별(일반/종합/상급/요양/간호간병) 하루 입원 시 받는 금액을 전 보험사 합산한다.
 *
 * 분류 규칙은 고객이 손으로 작성한 양식과 5개사 실제 제안서를 대조해 맞춘 것이다.
 * 확실하지 않은 값은 지어내지 않고 needsReview 로 표시한다.
 */

export const CATEGORIES = [
  '입원일당',
  '종합병원일당',
  '간병인사용일당',
  '요양병원및의원',
  '통합간호간병',
  '간병페이백',
  '상급1인실',
  '상급2~3인실',
  '상급4~5인실',
  '종합1인실',
  '종합2~3인실',
  '종합4~5인실'
] as const

export type Category = (typeof CATEGORIES)[number]
export type Side = '상해' | '질병'
export const SIDES: Side[] = ['상해', '질병']

export const SANGGEUP_ROOMS: Category[] = ['상급1인실', '상급2~3인실', '상급4~5인실']
export const GENERAL_ROOMS: Category[] = ['종합1인실', '종합2~3인실', '종합4~5인실']

export interface Classification {
  categories: Category[]
  sides: Side[]
  value: number | null
  needsReview: boolean
  payback: boolean
  reason: string
}

const COMPANY_PATTERNS: [RegExp, string][] = [
  [/NH농협생명|농협생명|NH올원더풀|건강플러스NH/, '농협생명'],
  [/메리츠화재|메리츠/, '메리츠'],
  [/하나생명/, '하나생명'],
  [/현대해상/, '현대해상'],
  [/흥국생명/, '흥국생명'],
  [/흥국화재/, '흥국화재'],
  [/삼성화재/, '삼성화재'],
  [/삼성생명/, '삼성생명'],
  [/DB손해보험|DB손보/, 'DB손해보험'],
  [/KB손해보험|KB손보/, 'KB손해보험'],
  [/롯데손해보험/, '롯데손해보험'],
  [/한화손해보험/, '한화손해보험'],
  [/한화생명/, '한화생명'],
  [/MG손해보험/, 'MG손해보험'],
  [/농협손해보험/, '농협손해보험'],
  [/교보생명/, '교보생명'],
  [/신한라이프/, '신한라이프'],
  [/동양생명/, '동양생명'],
  [/미래에셋생명/, '미래에셋생명'],
  [/ABL생명/, 'ABL생명'],
  [/AIA생명/, 'AIA생명'],
  [/라이나생명/, '라이나생명'],
  [/KDB생명/, 'KDB생명'],
  [/DGB생명/, 'DGB생명']
]

const PAYBACK_PATTERN = /간병인지원|입원지원금|간병지원금|간병페이백/
// "※ ○○특약의 경우..."처럼 가입하지 않은 특약을 설명하는 안내문
const NOTE_LINE = /^\s*[※*▶◈·]|^\s*주\s*\)/

/* ---------- 문서 단위 정보 ---------- */

export function detectCompany(pages: PageItems[], fileName = ''): string | null {
  const haystack = documentLines(pages, 4).join(' ').replace(/\s/g, '') + fileName.replace(/\s/g, '')
  for (const [pattern, name] of COMPANY_PATTERNS) {
    if (pattern.test(haystack)) return name
  }
  return /흥생/.test(fileName) ? '흥국생명' : null
}

// 요약표에서 빠질 수 있는 담보라 문서 전체에서 확인한다(안내문 제외).
export function detectPayback(pages: PageItems[]): boolean {
  return documentLines(pages).some((line) => !NOTE_LINE.test(line) && PAYBACK_PATTERN.test(line.replace(/\s/g, '')))
}

function moneyValues(line: string): number[] {
  return [...line.matchAll(/([\d,]{3,})원?/g)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((v) => Number.isFinite(v) && v >= 1000)
}

function pickPremium(values: number[]): number | null {
  if (values.length === 0) return null
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const repeated = [...counts.entries()].filter(([, c]) => c > 1).map(([v]) => v)
  return repeated.length > 0 ? Math.max(...repeated) : Math.max(...values)
}

// 실제 내는 금액 기준: "1회차보험료(할인후)"가 있으면 그 값, 없으면 합계·실납입 보험료.
export function findTotalPremium(pages: PageItems[]): number | null {
  const discounted: number[] = []
  const totals: number[] = []
  for (const raw of documentLines(pages)) {
    if (NOTE_LINE.test(raw)) continue
    const line = raw.replace(/\s/g, '')
    if (/할인후/.test(line)) discounted.push(...moneyValues(line))
    else if (/(합계보험료|보험료합계|실납입보험료|보장보험료합계)/.test(line)) totals.push(...moneyValues(line))
  }
  return pickPremium(discounted) ?? pickPremium(totals)
}

/* ---------- 담보 분류 ---------- */

// 가입금액 표기를 일당(만원) 숫자로 바꾼다. 일당으로 보기 어려우면 null.
export function toDailyManwon(amountText: string): { value: number | null; reason: string } {
  const text = String(amountText || '').replace(/\s/g, '')
  if (!text) return { value: null, reason: '가입금액 없음' }
  if (text.includes('확인필요')) return { value: null, reason: '금액 확인 필요' }
  const match = text.match(/^([\d,]+(?:\.\d+)?)만원?$/)
  if (match) {
    const value = Number(match[1].replace(/,/g, ''))
    // 일당 담보 가입금액이 100만원을 넘으면 일당이 아니라 보장금액일 가능성이 크다(NH 등).
    return value > 100 ? { value: null, reason: '일당이 아니라 보장금액으로 보임' } : { value, reason: '' }
  }
  if (/^[\d,]+(?:\.\d+)?(천만원?|억원?|백만원?)$/.test(text)) return { value: null, reason: '일당이 아니라 보장금액으로 보임' }
  if (/^[\d,]+원$/.test(text)) return { value: null, reason: '원 단위 금액' }
  return { value: null, reason: '단위를 알 수 없음' }
}

// 담보명 뒤 상품 형태 표기는 분류에 방해가 되므로 뗀다. 예: (무배당), (해약환급금 미지급형, 일반심사형)
const FORM_SUFFIX =
  /\([^()]*(?:무배당|해약환급금|해약미지급|미지급형|일반심사형|간편가입|통합간편|간편형|간편|사망시적립액|납입면제형|고지형|V2|배당)[^()]*\)/g

function cleanName(name: string): string {
  return String(name || '')
    .replace(/^\s*\d{1,3}\s*[.,]\s*/, '')
    .replace(/\(무\)|\(무배당\)/g, '')
    .replace(FORM_SUFFIX, '')
    .replace(/\s/g, '')
}

function sidesOf(name: string): Side[] {
  const injury = /상해|재해/.test(name)
  const illness = /질병/.test(name)
  if (injury && !illness) return ['상해']
  if (illness && !injury) return ['질병']
  return ['상해', '질병']
}

export function classifyCoverage(coverageName: string, amountText: string): Classification {
  const name = cleanName(coverageName)
  const result: Classification = { categories: [], sides: sidesOf(name), value: null, needsReview: false, payback: false, reason: '' }

  if (!name) return { ...result, reason: '담보명 없음' }
  // 181일 이상 연장 담보는 기본(1~180일) 담보와 중복이므로 제외한다.
  if (/181일이상|181[-~]\d+일|\(181/.test(name)) return { ...result, reason: '181일 이상 담보(기본 담보와 중복)' }
  if (PAYBACK_PATTERN.test(name)) return { ...result, payback: true, reason: '간병페이백 여부로만 사용' }
  if (/중환자실|응급실/.test(name)) return { ...result, reason: '양식에 없는 담보' }

  const { value, reason } = toDailyManwon(amountText)
  result.value = value

  const isSanggeup = /상급종합병원/.test(name)
  const isAdmission = /입원/.test(name)

  if (/간호.?간병통합/.test(name)) {
    result.categories = ['통합간호간병']
  } else if (/간병인사용|간병사용|간병인/.test(name)) {
    result.categories = [/요양병원/.test(name) && !/제외/.test(name) ? '요양병원및의원' : '간병인사용일당']
  } else if (/1인실/.test(name)) {
    result.categories = [isSanggeup ? '상급1인실' : '종합1인실']
  } else if (/2[-~]3인실/.test(name)) {
    result.categories = [isSanggeup ? '상급2~3인실' : '종합2~3인실']
  } else if (/4[-~]5인실/.test(name)) {
    result.categories = [isSanggeup ? '상급4~5인실' : '종합4~5인실']
  } else if (/사망|후유장해|장해|수술|진단|납입면제|생활자금|골절|화상|암|뇌|심장/.test(name)) {
    return { ...result, value: null, reason: '양식에 없는 담보' }
  } else if (isSanggeup && isAdmission) {
    // 병실 구분이 없는 상급종합병원 입원 담보 → 상급 3개 항목에 같은 값(확인 필요)
    result.categories = [...SANGGEUP_ROOMS]
    result.needsReview = true
    result.reason = '병실 구분이 없어 상급 3개 항목에 같은 값'
  } else if (/종합병원/.test(name) && isAdmission) {
    result.categories = ['종합병원일당']
  } else if (isAdmission) {
    result.categories = ['입원일당']
  } else {
    return { ...result, value: null, reason: '양식에 없는 담보' }
  }

  if (result.value === null) {
    result.needsReview = true
    result.reason = result.reason || reason || '값 확인 필요'
  }
  return result
}

/* ---------- 간병 페이백 안내 ---------- */

export interface PaybackNote {
  company: string
  text: string
  evidence: string[]
}

// NH식 "간병인 사용금액이 1일당 7만원 미만" / 메리츠식 "1일당 간병인 사용금액 7만원 미만" 둘 다 찾는다.
const THRESHOLD = /(?:간병인사용금액이?1일당|1일당간병인사용금액이?)([\d.]+)만원(미만|이상)/
const LIMIT = /1일당간병인사용금액([\d.]+)만원한도|간병인사용금액은1일당([\d.]+)만원을?한도/
const BELOW_PAYOUT = /가입금액의([\d.]+)%/

// 간병인 지원금 조건을 원문에서 찾아 쉬운 문장으로 바꾼다. 근거를 못 찾은 부분은 지어내지 않는다.
export function describePayback(pages: PageItems[], company: string): PaybackNote | null {
  let threshold: number | null = null
  let limit: number | null = null
  let belowPercent: number | null = null
  const evidence: string[] = []

  for (const line of documentLines(pages)) {
    const compact = line.replace(/\s/g, '')
    const t = compact.match(THRESHOLD)
    if (t) {
      threshold = threshold ?? Number(t[1])
      if (evidence.length < 4) evidence.push(line.trim().slice(0, 120))
    }
    const l = compact.match(LIMIT)
    if (l) limit = limit ?? Number(l[1] || l[2])
    if (belowPercent === null && /미만/.test(compact)) {
      const p = compact.match(BELOW_PAYOUT)
      if (p) belowPercent = Number(p[1])
    }
  }
  if (threshold === null && limit === null) return null

  const parts: string[] = []
  if (threshold !== null) {
    parts.push(
      belowPercent !== null
        ? `간병인을 하루 ${threshold}만원 이상 쓰면 가입금액 전액이 나오고, ${threshold}만원 미만이면 가입금액의 ${belowPercent}%만 나옵니다.`
        : `간병인을 하루 ${threshold}만원 이상 쓰는지에 따라 지급액이 달라집니다(미만일 때 지급액은 원문 확인 필요).`
    )
  }
  if (limit !== null) parts.push(`하루 간병인 사용금액은 ${limit}만원까지만 인정됩니다.`)
  return { company: company || '이 보험사', text: parts.join(' '), evidence }
}

/* ---------- 최종 합계표 ---------- */

export interface SummaryScenario {
  label: string
  parts: Category[]
  sanggeup?: boolean
}

// 하루 입원했을 때 실제로 받는 금액을 상황별로 합산한다(체크된 담보, 전 보험사).
export const SUMMARY_SCENARIOS: SummaryScenario[] = [
  { label: '일반병원 입원', parts: ['입원일당', '간병인사용일당'] },
  { label: '종합병원 입원', parts: ['입원일당', '간병인사용일당', '종합병원일당'] },
  { label: '종합병원 1인실', parts: ['입원일당', '간병인사용일당', '종합병원일당', '종합1인실'] },
  { label: '종합병원 2~3인실', parts: ['입원일당', '간병인사용일당', '종합병원일당', '종합2~3인실'] },
  { label: '종합병원 4~5인실', parts: ['입원일당', '간병인사용일당', '종합병원일당', '종합4~5인실'] },
  { label: '상급병원 1인실', parts: ['입원일당', '간병인사용일당', '상급1인실'], sanggeup: true },
  { label: '상급병원 2~3인실', parts: ['입원일당', '간병인사용일당', '상급2~3인실'], sanggeup: true },
  { label: '상급병원 4~5인실', parts: ['입원일당', '간병인사용일당', '상급4~5인실'], sanggeup: true },
  { label: '요양병원·의원', parts: ['요양병원및의원'] },
  { label: '간호간병통합서비스 병동', parts: ['입원일당', '통합간호간병'] }
]

export interface SummaryRow {
  label: string
  parts: Category[]
  상해: number
  질병: number
}

export function computeSummary(
  companies: string[],
  valueOf: (company: string, category: Category, side: Side) => string,
  sanggeupIncludesGeneral: boolean
): SummaryRow[] {
  return SUMMARY_SCENARIOS.map((scenario) => {
    const parts: Category[] =
      scenario.sanggeup && sanggeupIncludesGeneral ? [...scenario.parts, '종합병원일당'] : scenario.parts
    const row: SummaryRow = { label: scenario.label, parts, 상해: 0, 질병: 0 }
    for (const company of companies) {
      for (const side of SIDES) {
        for (const category of parts) {
          const value = Number(valueOf(company, category, side))
          if (valueOf(company, category, side) !== '' && Number.isFinite(value)) row[side] += value
        }
      }
    }
    row.상해 = Math.round(row.상해 * 100) / 100
    row.질병 = Math.round(row.질병 * 100) / 100
    return row
  })
}
