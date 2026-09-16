import * as XLSX from 'xlsx'

/**
 * 보장분석 정리 — 고객 보유 보험을 담보별로 정리하고 부족/미가입을 한눈에 본다.
 *
 * 저장은 이 브라우저(localStorage) — FC 개인 작업 자료. 권장금액은 "참고 기준"이며
 * 화면에서 자유롭게 수정한다(회사/설계 기준에 맞게). 엑셀 내보내기 지원.
 */

export type CovUnit = 'amount' | 'daily' | 'yn'

export interface HeldPolicy {
  id: string
  insurer: string
  product: string
  ptype: string // 종신/건강/실손/암/운전자/연금/저축 등 자유입력
  monthly: number // 월 보험료(원)
}

export interface CoverageRow {
  key: string
  label: string
  unit: CovUnit
  current: number // amount/daily: 원 · yn: 1(가입)/0(미가입)
  recommended: number // 권장 기준(참고, 편집 가능) · yn: 1
}

export interface CoverageAnalysis {
  id: string
  customerName: string
  birth?: string
  memo?: string
  policies: HeldPolicy[]
  coverages: CoverageRow[]
  updatedAt: string
}

export type Verdict = 'none' | 'short' | 'ok' | 'yes'

const STORAGE_KEY = 'sj-os:coverage-analysis:v1'

/** 표준 담보 카테고리 + 참고 권장금액(수정 가능). */
export function defaultCoverages(): CoverageRow[] {
  const A = (key: string, label: string, recommended: number): CoverageRow => ({
    key,
    label,
    unit: 'amount',
    current: 0,
    recommended
  })
  const D = (key: string, label: string, recommended: number): CoverageRow => ({
    key,
    label,
    unit: 'daily',
    current: 0,
    recommended
  })
  const Y = (key: string, label: string): CoverageRow => ({ key, label, unit: 'yn', current: 0, recommended: 1 })
  return [
    A('death', '일반사망', 100_000_000),
    A('disease_death', '질병사망', 50_000_000),
    A('cancer', '암 진단비', 30_000_000),
    A('brain', '뇌혈관 진단비', 20_000_000),
    A('heart', '허혈성심장 진단비', 20_000_000),
    A('surgery', '수술비(질병·상해)', 3_000_000),
    D('disease_hosp', '질병 입원일당', 30_000),
    D('injury_hosp', '상해 입원일당', 30_000),
    Y('medical_actual', '실손의료비'),
    A('disability', '후유장해', 100_000_000),
    Y('driver', '운전자/교통'),
    Y('liability', '일상배상책임'),
    A('ltc', '간병·장기요양', 10_000_000)
  ]
}

export function verdictOf(r: CoverageRow): Verdict {
  if (r.unit === 'yn') return r.current >= 1 ? 'yes' : 'none'
  if (r.current <= 0) return 'none'
  return r.current < r.recommended ? 'short' : 'ok'
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  none: '미가입',
  short: '부족',
  ok: '충분',
  yes: '가입'
}
export const VERDICT_TONE: Record<Verdict, 'rose' | 'amber' | 'emerald' | 'slate'> = {
  none: 'rose',
  short: 'amber',
  ok: 'emerald',
  yes: 'emerald'
}

export function blankAnalysis(): CoverageAnalysis {
  return {
    id: `ca_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    customerName: '',
    birth: '',
    memo: '',
    policies: [],
    coverages: defaultCoverages(),
    updatedAt: new Date().toISOString()
  }
}

export function summarize(a: CoverageAnalysis): {
  monthlyTotal: number
  none: number
  short: number
  ok: number
} {
  const monthlyTotal = a.policies.reduce((n, p) => n + (Number(p.monthly) || 0), 0)
  let none = 0
  let short = 0
  let ok = 0
  for (const r of a.coverages) {
    const v = verdictOf(r)
    if (v === 'none') none++
    else if (v === 'short') short++
    else ok++
  }
  return { monthlyTotal, none, short, ok }
}

function normalize(list: unknown): CoverageAnalysis[] {
  if (!Array.isArray(list)) return []
  return list.filter((x) => x && typeof x === 'object') as CoverageAnalysis[]
}

export function listAnalyses(): CoverageAnalysis[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalize(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return []
}

export function saveAnalysis(a: CoverageAnalysis): CoverageAnalysis[] {
  const next = listAnalyses()
  const withTs = { ...a, updatedAt: new Date().toISOString() }
  const idx = next.findIndex((x) => x.id === a.id)
  if (idx >= 0) next[idx] = withTs
  else next.unshift(withTs)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
  return next
}

export function removeAnalysis(id: string): CoverageAnalysis[] {
  const next = listAnalyses().filter((x) => x.id !== id)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

function fmtCell(r: CoverageRow, which: 'current' | 'recommended'): string {
  const v = which === 'current' ? r.current : r.recommended
  if (r.unit === 'yn') return v >= 1 ? '가입' : '미가입'
  if (r.unit === 'daily') return `${(Number(v) || 0).toLocaleString('ko-KR')}원/일`
  return `${(Number(v) || 0).toLocaleString('ko-KR')}원`
}

/** 현재 보장분석을 엑셀로 내보낸다. */
export function exportAnalysis(a: CoverageAnalysis): void {
  const wb = XLSX.utils.book_new()

  const info: (string | number)[][] = [
    ['보장분석 정리'],
    ['고객명', a.customerName || ''],
    ['생년', a.birth || ''],
    ['메모', a.memo || ''],
    ['작성일', new Date(a.updatedAt).toLocaleString('ko-KR')],
    []
  ]
  const covHeader = ['담보', '현재', '권장(참고)', '판정']
  const covRows = a.coverages.map((r) => [r.label, fmtCell(r, 'current'), fmtCell(r, 'recommended'), VERDICT_LABEL[verdictOf(r)]])
  const covAll = [...info, covHeader, ...covRows]
  const ws1 = XLSX.utils.aoa_to_sheet(covAll)
  XLSX.utils.book_append_sheet(wb, ws1, '담보정리')

  const polHeader = ['보험사', '상품명', '종류', '월보험료(원)']
  const polRows = a.policies.map((p) => [p.insurer, p.product, p.ptype, Number(p.monthly) || 0])
  const total = a.policies.reduce((n, p) => n + (Number(p.monthly) || 0), 0)
  const ws2 = XLSX.utils.aoa_to_sheet([polHeader, ...polRows, ['', '', '합계', total]])
  XLSX.utils.book_append_sheet(wb, ws2, '보유계약')

  const name = a.customerName ? `보장분석_${a.customerName}` : '보장분석'
  XLSX.writeFile(wb, `${name}.xlsx`)
}
