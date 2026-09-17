import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import type { PaybackNote, SummaryRow } from './hospitalCoverage'

/**
 * 가입제안서 담보 정리 — "이 보험의 장점" 요약.
 *
 * 금액을 읽어주는 대신 보험사별로 고객에게 설명할 장점을 짧게 정리한다.
 * AI 요약(proposal-summary edge function)에는 화면에서 계산한 숫자와 회사명만 보낸다.
 * 고객 이름·파일명·제안서 원문은 보내지 않는다. 서버에 연결할 수 없으면 숫자 비교로 만든 기본 요약을 쓴다.
 */

export interface SummaryCompanyInput {
  company: string
  monthlyPremium: number | null
  payback: boolean
  dailyByCategory: Record<string, { 상해?: number; 질병?: number }>
}

export interface ProposalSummaryInput {
  companies: SummaryCompanyInput[] // 보험료 낮은 순
  summary: SummaryRow[]
  paybackNotes: PaybackNote[]
}

export interface CompanyAdvantages {
  company: string
  points: string[]
}

export interface ProposalSummary {
  headline: string
  companies: CompanyAdvantages[]
}

async function bearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

export async function requestAiSummary(input: ProposalSummaryInput): Promise<{ ok: boolean; summary?: ProposalSummary; error?: string }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: 'AI 요약은 서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60000)
  try {
    const token = (await bearer()) ?? anon
    const res = await fetch(`${base}/proposal-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        companies: input.companies,
        summary: input.summary.map((row) => ({ label: row.label, byCompany: row.byCompany })),
        paybackNotes: input.paybackNotes.map((note) => ({ company: note.company, text: note.text }))
      }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; result?: Partial<ProposalSummary> } | null
    if (res.status === 404) return { ok: false, error: 'AI 요약 기능이 아직 서버에 설치되지 않았습니다.' }
    if (!res.ok || !data?.success || !data.result) return { ok: false, error: data?.error ?? `AI 요약 실패 (HTTP ${res.status})` }
    const companies = (Array.isArray(data.result.companies) ? data.result.companies : [])
      .map((c) => ({ company: String(c?.company ?? ''), points: Array.isArray(c?.points) ? c.points.map(String).filter(Boolean) : [] }))
      .filter((c) => c.company && c.points.length)
    return { ok: true, summary: { headline: String(data.result.headline ?? ''), companies } }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'AI 요약 시간이 초과되었습니다.' : 'AI 요약 서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/* ---------- 기본 요약(서버 없이 숫자 비교) ---------- */

const manwon = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}만원`
const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`

// 장점으로 비교할 상황과 고객에게 들려줄 말.
const STRENGTHS: { label: string; phrase: string }[] = [
  { label: '일반병원 입원', phrase: '일반 병원에 입원해도' },
  { label: '종합병원 입원', phrase: '종합병원에 입원하면' },
  { label: '상급병원 1인실', phrase: '대학병원(상급종합병원) 1인실을 쓰면' },
  { label: '간호간병통합서비스 병동', phrase: '간호간병통합서비스 병동에 입원하면' },
  { label: '요양병원·의원', phrase: '요양병원에 입원하면' }
]

// 받침에 맞는 조사(이/가).
const iga = (word: string): string => {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '이' : '가'
}

const has = (c: SummaryCompanyInput, category: string): boolean => {
  const v = c.dailyByCategory[category]
  return Boolean(v && (v.상해 || v.질병))
}

export function buildBasicSummary(input: ProposalSummaryInput): ProposalSummary {
  const companies = input.companies
  const multi = companies.length > 1
  const priced = companies.filter((c) => c.monthlyPremium !== null && c.monthlyPremium > 0)
  const cheapest = priced[0]
  const dearest = priced[priced.length - 1]
  const coverageCount = (c: SummaryCompanyInput): number => Object.keys(c.dailyByCategory).length
  const widest = [...companies].sort((a, b) => coverageCount(b) - coverageCount(a))[0]

  const result: CompanyAdvantages[] = companies.map((c) => {
    const points: string[] = []

    if (multi && cheapest && c.company === cheapest.company && dearest && dearest.company !== cheapest.company) {
      points.push(`비교한 제안서 중 월 보험료가 가장 저렴합니다(월 ${won(c.monthlyPremium!)}, ${dearest.company}보다 월 ${won(dearest.monthlyPremium! - c.monthlyPremium!)} 적음).`)
    }

    // 간병 페이백은 고객이 체감하는 장점이라 앞쪽에 둔다.
    const note = input.paybackNotes.find((n) => n.company === c.company)
    if (note) points.push(`간병 페이백: ${note.text}`)

    // 상황별로 이 회사가 가장 많이 주는 경우만 장점으로 뽑는다.
    // 일반병원과 금액이 같은 상황(종합·상급 추가 보장이 없는 경우)은 같은 말을 반복하지 않는다.
    const base = input.summary.find((s) => s.label === '일반병원 입원')?.byCompany[c.company]
    let strengthCount = 0
    for (const { label, phrase } of STRENGTHS) {
      const row = input.summary.find((s) => s.label === label)
      const mine = row?.byCompany[c.company]
      if (!row || !mine) continue
      const sides = (['질병', '상해'] as const).filter((side) => {
        if (!mine[side]) return false
        if (label !== '일반병원 입원' && label !== '요양병원·의원' && base && mine[side] === base[side]) return false
        if (!multi) return true
        const others = companies.filter((o) => o.company !== c.company).map((o) => row.byCompany[o.company]?.[side] ?? 0)
        return others.every((v) => mine[side] > v)
      })
      if (sides.length === 0) continue
      const amount = sides.map((side) => `${side} ${manwon(mine[side])}`).join(' · ')
      points.push(multi ? `${phrase} 하루 ${amount}으로 비교한 제안서 중 가장 든든합니다.` : `${phrase} 하루 ${amount}을 받습니다.`)
      if (++strengthCount >= 3) break
    }

    // 다른 제안서에 없는 보장
    const unique = (category: string): boolean => has(c, category) && (!multi || companies.every((o) => o.company === c.company || !has(o, category)))
    if (unique('간병인사용일당')) points.push('간병인을 쓰면 간병인 일당이 따로 나와 간병비 부담을 덜어줍니다.')
    if (unique('통합간호간병')) points.push('간호간병통합서비스 병동 입원 시 별도로 지급되어 보호자 간병 부담이 줄어듭니다.')
    if (['상급1인실', '상급2~3인실', '상급4~5인실'].some(unique)) points.push('대학병원 상급병실 입원비를 따로 보장해 병실료 부담을 줄여줍니다.')
    if (unique('종합병원일당')) points.push('종합병원에 입원하면 추가 일당이 더 붙습니다.')
    if (unique('요양병원및의원')) points.push('요양병원·의원 입원도 보장합니다.')

    if (points.length === 0 && multi && widest && widest.company === c.company) points.push('입원·간병 보장 항목이 가장 다양합니다.')
    return { company: c.company, points: points.slice(0, 5) }
  })

  let headline: string
  if (!multi) {
    headline = companies[0] ? `${companies[0].company} 제안서의 입원·간병 보장 장점입니다.` : ''
  } else if (cheapest && widest && cheapest.company !== widest.company && coverageCount(widest) > coverageCount(cheapest)) {
    headline = `보험료는 ${cheapest.company}, 보장 폭은 ${widest.company}${iga(widest.company)} 강점입니다.`
  } else if (cheapest && widest && cheapest.company === widest.company) {
    headline = `${cheapest.company}${iga(cheapest.company)} 보험료도 가장 저렴하고 입원·간병 보장 항목도 가장 다양합니다.`
  } else if (cheapest) {
    headline = `보험료는 ${cheapest.company}${iga(cheapest.company)} 가장 저렴합니다. 보험사별 장점을 비교해 보세요.`
  } else {
    headline = `보험사 ${companies.length}곳 제안서의 장점을 비교했습니다.`
  }
  return { headline, companies: result }
}

export function summaryToText(summary: ProposalSummary, premiums: Map<string, number | null> = new Map()): string {
  const blocks = summary.companies
    .filter((c) => c.points.length)
    .map((c) => {
      const premium = premiums.get(c.company)
      return [`[${c.company}]${premium ? ` 월 ${won(premium)}` : ''}`, ...c.points.map((p) => `• ${p}`)].join('\n')
    })
  return [summary.headline, ...blocks].filter(Boolean).join('\n\n')
}
