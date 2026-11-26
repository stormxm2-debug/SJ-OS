/**
 * DB 배분 결과 요약 — 이미지(카톡 공유용)로 만들 내용을 계산한다(순수 함수).
 * 개인정보(고객 이름·전화)는 넣지 않는다 — 직원별·지역별 건수만 담는다.
 */

export interface LeadSummaryInput {
  dbType?: string
  /** 'auto' | 'counts' | 'region' | 'single' */
  mode: string
  groups: { name: string; count: number }[]
  unassigned: number
  regions: { region: string; count: number }[]
  at?: Date
}

export interface LeadSummary {
  title: string
  subtitle: string
  total: number
  assigned: number
  unassigned: number
  groups: { name: string; count: number; pct: number }[]
  regions: { region: string; count: number }[]
  /** 지역이 9개 이상이면 나머지 합계 */
  regionsRest: number
}

export const MODE_LABEL: Record<string, string> = {
  auto: '자동 균등 배정',
  counts: '개수 지정 배정',
  region: '지역별 FC 배정',
  single: '직원 1명 배정'
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function buildSummary(input: LeadSummaryInput): LeadSummary {
  const at = input.at ?? new Date()
  const groups = input.groups.filter((g) => g.count > 0).sort((a, b) => b.count - a.count)
  const assigned = groups.reduce((a, g) => a + g.count, 0)
  const total = assigned + Math.max(0, input.unassigned)
  const regionsAll = [...input.regions].sort((a, b) => b.count - a.count)
  const regions = regionsAll.slice(0, 8)
  const regionsRest = regionsAll.slice(8).reduce((a, r) => a + r.count, 0)
  const date = `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const parts = [date, input.dbType ? `[${input.dbType}]` : '', MODE_LABEL[input.mode] ?? ''].filter(Boolean)
  return {
    title: 'DB 배분 결과',
    subtitle: parts.join(' · '),
    total,
    assigned,
    unassigned: Math.max(0, input.unassigned),
    groups: groups.map((g) => ({ name: g.name, count: g.count, pct: assigned > 0 ? Math.round((g.count / assigned) * 100) : 0 })),
    regions,
    regionsRest
  }
}

export const SUMMARY_WIDTH = 1080
const HEADER_H = 190
const TOTAL_H = 170
const SECTION_H = 76
const ROW_H = 64
const REGION_ROW_H = 52
const FOOTER_H = 90

export function summaryHeight(s: LeadSummary): number {
  let h = HEADER_H + TOTAL_H
  if (s.groups.length > 0) h += SECTION_H + s.groups.length * ROW_H
  if (s.regions.length > 0) h += SECTION_H + (s.regions.length + (s.regionsRest > 0 ? 1 : 0)) * REGION_ROW_H
  return h + FOOTER_H
}

export const SUMMARY_LAYOUT = { HEADER_H, TOTAL_H, SECTION_H, ROW_H, REGION_ROW_H, FOOTER_H }
