import type { LeadInput } from './leadService'

/**
 * DB 배분 계획 — 순수 계산(저장·화면 없음).
 *  - 업로드한 DB의 분석 요약(건수·전화 형식·지역 분포)
 *  - 직원별 '개수 지정' 배정 계획(합계 검증 · 남는 건은 미배정으로)
 * 화면과 서버 호출은 LeadDistributionPage / leadService 가 맡는다.
 */

const SIDO: [string, string[]][] = [
  ['서울', ['서울']],
  ['부산', ['부산']],
  ['대구', ['대구']],
  ['인천', ['인천']],
  ['광주', ['광주']],
  ['대전', ['대전']],
  ['울산', ['울산']],
  ['세종', ['세종']],
  ['경기', ['경기']],
  ['강원', ['강원']],
  ['충북', ['충청북', '충북']],
  ['충남', ['충청남', '충남']],
  ['전북', ['전라북', '전북']],
  ['전남', ['전라남', '전남']],
  ['경북', ['경상북', '경북']],
  ['경남', ['경상남', '경남']],
  ['제주', ['제주']]
]

/** "광주 광산구 ○○동" → "광주", "전라남도 화순군" → "전남". 시·도를 못 알아보면 첫 단어. */
export function normalizeRegion(raw: string): string {
  const t = (raw ?? '').trim()
  if (!t) return ''
  for (const [abbr, keys] of SIDO) {
    for (const k of keys) if (t.startsWith(k)) return abbr
  }
  return t.split(/\s+/)[0].slice(0, 10)
}

const REGION_HEADER = /^(지역|시도|시\/도|광역|시군구|시\/군\/구|군구|구군|시군|주소|거주|소재지)/

/** 지역을 나누는 단위: 시·도(전남) 또는 시·군·구(전남 화순군). */
export type RegionLevel = 'sido' | 'sigungu'

/**
 * 주소 문자열 → 지역 이름.
 *  - sido    : "전라남도 화순군 ○○읍" → "전남"
 *  - sigungu : "전라남도 화순군 ○○읍" → "전남 화순군", "광주 광산구 ○○동" → "광주 광산구"
 * 시·군·구를 못 찾으면 시·도만 돌려준다.
 */
export function regionFromText(raw: string, level: RegionLevel = 'sido'): string {
  // 앞에 붙은 우편번호 "(58100)" / "58100" 은 지운다.
  const text = (raw ?? '').trim().replace(/^[([]?\d{5}[)\]]?[\s,]*/, '')
  if (!text) return ''
  const sido = normalizeRegion(text)
  if (level === 'sido') return sido
  const tokens = text.split(/\s+/)
  // 첫 단어는 시·도(또는 알 수 없는 지역명)이므로, 그 뒤에서 시·군·구를 찾는다.
  const sigungu = tokens.slice(1).find((t) => t.length >= 2 && /[시군구]$/.test(t))
  return sigungu ? `${sido} ${sigungu}` : sido
}

/** 파일 판독이 메모에 합쳐 둔 "헤더: 값 / 헤더: 값" 에서 지역을 꺼낸다. 없으면 ''. */
export function regionOfLead(lead: LeadInput, level: RegionLevel = 'sido'): string {
  const memo = lead.memo ?? ''
  // 시도·시군구·주소처럼 지역에 관한 열이 여러 개면 순서대로 이어 붙여서 한 번에 읽는다.
  const values: string[] = []
  for (const part of memo.split(' / ')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const header = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    if (REGION_HEADER.test(header) && value) values.push(value)
  }
  return values.length > 0 ? regionFromText(values.join(' '), level) : ''
}

const PHONE_OK = /^01\d-?\d{3,4}-?\d{4}$/

export interface LeadAnalysis {
  total: number
  withPhone: number
  /** 전화번호가 없거나 휴대폰 형식(01X)이 아닌 건 */
  invalidPhone: number
  /** 지역별 건수(많은 순). 지역 열이 없으면 빈 배열. */
  regions: { region: string; count: number }[]
  noRegion: number
}

export function analyzeLeads(rows: LeadInput[], level: RegionLevel = 'sido'): LeadAnalysis {
  let withPhone = 0
  let invalidPhone = 0
  let noRegion = 0
  const byRegion = new Map<string, number>()
  for (const r of rows) {
    const phone = (r.phone ?? '').trim()
    if (phone) withPhone += 1
    if (!PHONE_OK.test(phone)) invalidPhone += 1
    const region = regionOfLead(r, level)
    if (!region) noRegion += 1
    else byRegion.set(region, (byRegion.get(region) ?? 0) + 1)
  }
  const regions = [...byRegion.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count)
  return { total: rows.length, withPhone, invalidPhone, regions, noRegion }
}

/** 총 건수를 직원 수로 균등 분할(나머지는 앞사람부터 +1). */
export function equalCounts(total: number, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (ids.length === 0) return out
  const base = Math.floor(total / ids.length)
  const rem = total % ids.length
  ids.forEach((id, i) => {
    out[id] = base + (i < rem ? 1 : 0)
  })
  return out
}

/** 입력칸 문자열 → 0 이상 정수 (빈칸·음수·소수·문자는 0). */
export function toCount(v: unknown): number {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export interface CountPlan {
  ok: boolean
  error?: string
  /** 직원별로 받을 행 (건수 0인 직원은 빠진다). 파일 순서대로 앞에서부터 잘라 준다. */
  groups: { fcId: string; rows: LeadInput[] }[]
  /** 어느 직원에게도 안 간 행 — 미배정으로 저장한다. */
  leftover: LeadInput[]
}

export function planByCounts(rows: LeadInput[], order: string[], counts: Record<string, unknown>): CountPlan {
  const wanted = order.map((id) => ({ id, n: toCount(counts[id]) })).filter((x) => x.n > 0)
  const sum = wanted.reduce((a, b) => a + b.n, 0)
  if (rows.length === 0) return { ok: false, error: '배정할 DB가 없습니다.', groups: [], leftover: [] }
  if (sum === 0) return { ok: false, error: '직원별 개수를 입력해 주세요.', groups: [], leftover: [] }
  if (sum > rows.length) {
    return { ok: false, error: `입력한 합계(${sum}건)가 배정할 DB(${rows.length}건)보다 많습니다.`, groups: [], leftover: [] }
  }
  const groups: { fcId: string; rows: LeadInput[] }[] = []
  let cursor = 0
  for (const w of wanted) {
    groups.push({ fcId: w.id, rows: rows.slice(cursor, cursor + w.n) })
    cursor += w.n
  }
  return { ok: true, groups, leftover: rows.slice(cursor) }
}

export interface RegionPlan {
  ok: boolean
  error?: string
  groups: { fcId: string; rows: LeadInput[] }[]
  /** 지역이 없거나 담당 FC가 없거나, FC 상한에 걸린 행 — 미배정으로 저장한다. */
  leftover: LeadInput[]
}

/**
 * 지역별 담당 FC 배정.
 *  - 행의 지역(시·도)에 담당 FC가 있으면 그 FC들에게, 현재 받은 건수가 가장 적은 사람부터 번갈아 준다.
 *  - cap(FC당 최대 건수)이 있으면 다 찬 FC는 건너뛰고, 모두 차면 미배정으로 남긴다.
 *  - 지역이 없거나 담당 FC가 없는 행은 미배정.
 */
export function planByRegion(rows: LeadInput[], mapping: Record<string, string[]>, cap?: number, level: RegionLevel = 'sido'): RegionPlan {
  if (rows.length === 0) return { ok: false, error: '배정할 DB가 없습니다.', groups: [], leftover: [] }
  const mappedRegions = Object.entries(mapping).filter(([, ids]) => ids.length > 0)
  if (mappedRegions.length === 0) return { ok: false, error: '지역별 담당 FC를 한 곳 이상 지정해 주세요.', groups: [], leftover: [] }

  const limit = cap && cap > 0 ? Math.floor(cap) : Infinity
  const received = new Map<string, LeadInput[]>()
  const leftover: LeadInput[] = []
  for (const row of rows) {
    const region = regionOfLead(row, level)
    const candidates = region ? mapping[region] ?? [] : []
    let pick: string | null = null
    for (const id of candidates) {
      const n = received.get(id)?.length ?? 0
      if (n >= limit) continue
      if (pick === null || n < (received.get(pick)?.length ?? 0)) pick = id
    }
    if (pick === null) {
      leftover.push(row)
      continue
    }
    const list = received.get(pick) ?? []
    list.push(row)
    received.set(pick, list)
  }
  if (received.size === 0) return { ok: false, error: '담당 FC가 지정된 지역의 DB가 없습니다.', groups: [], leftover: rows }
  return { ok: true, groups: [...received.entries()].map(([fcId, r]) => ({ fcId, rows: r })), leftover }
}
