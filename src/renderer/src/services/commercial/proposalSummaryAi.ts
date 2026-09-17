import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import type { PaybackNote, SummaryRow } from './hospitalCoverage'

/**
 * 가입제안서 담보 정리 — 쉬운 요약 설명.
 *
 * AI 요약(proposal-summary edge function)은 화면에서 계산한 숫자만 보낸다.
 * 고객 이름·파일명·제안서 원문은 보내지 않는다. 서버에 연결할 수 없으면 숫자로 만든 기본 요약을 쓴다.
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

export interface ProposalSummary {
  headline: string
  points: string[]
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
        summary: input.summary.map((row) => ({ label: row.label, 상해: row.상해, 질병: row.질병 })),
        paybackNotes: input.paybackNotes.map((note) => ({ company: note.company, text: note.text }))
      }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; result?: ProposalSummary } | null
    if (res.status === 404) return { ok: false, error: 'AI 요약 기능이 아직 서버에 설치되지 않았습니다.' }
    if (!res.ok || !data?.success || !data.result) return { ok: false, error: data?.error ?? `AI 요약 실패 (HTTP ${res.status})` }
    const points = Array.isArray(data.result.points) ? data.result.points.map(String).filter(Boolean) : []
    return { ok: true, summary: { headline: String(data.result.headline ?? ''), points } }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'AI 요약 시간이 초과되었습니다.' : 'AI 요약 서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

const manwon = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}만원`
const pair = (row: SummaryRow | undefined): string =>
  row ? [row.상해 ? `상해 ${manwon(row.상해)}` : '', row.질병 ? `질병 ${manwon(row.질병)}` : ''].filter(Boolean).join(' · ') : ''

// 서버 없이 숫자만으로 만드는 기본 요약. 없는 값은 문장에 넣지 않는다.
export function buildBasicSummary(input: ProposalSummaryInput): ProposalSummary {
  const priced = input.companies.filter((c) => c.monthlyPremium !== null && c.monthlyPremium > 0)
  let headline = ''
  if (priced.length >= 2) {
    const cheap = priced[0]
    const dear = priced[priced.length - 1]
    headline = `월 보험료는 ${cheap.company}(${cheap.monthlyPremium!.toLocaleString('ko-KR')}원)이 가장 저렴하고, ${dear.company}(${dear.monthlyPremium!.toLocaleString('ko-KR')}원)이 가장 높습니다.`
  } else if (priced.length === 1) {
    headline = `${priced[0].company} 월 보험료는 ${priced[0].monthlyPremium!.toLocaleString('ko-KR')}원입니다.`
  } else {
    headline = `보험사 ${input.companies.length}곳의 입원·간병 보장을 정리했습니다.`
  }

  const find = (label: string): SummaryRow | undefined => input.summary.find((row) => row.label === label && (row.상해 || row.질병))
  const points: string[] = []
  if (priced.length >= 2) {
    points.push(`보험료 낮은 순: ${priced.map((c) => `${c.company} ${c.monthlyPremium!.toLocaleString('ko-KR')}원`).join(' → ')}`)
  }
  const general = pair(find('일반병원 입원'))
  if (general) points.push(`일반병원에 입원하면 하루 ${general}을 받습니다(전 보험사 합산).`)
  const hospital = pair(find('종합병원 입원'))
  if (hospital && hospital !== general) points.push(`종합병원에 입원하면 하루 ${hospital}입니다.`)
  const topRoom = input.summary
    .filter((row) => row.label.startsWith('상급병원') && (row.상해 || row.질병))
    .sort((a, b) => b.상해 + b.질병 - (a.상해 + a.질병))[0]
  if (topRoom) points.push(`${topRoom.label}을 쓰면 하루 ${pair(topRoom)}까지 받을 수 있습니다.`)
  const nursing = pair(find('간호간병통합서비스 병동'))
  if (nursing) points.push(`간호간병통합서비스 병동에 입원하면 하루 ${nursing}입니다.`)
  const care = pair(find('요양병원·의원'))
  if (care) points.push(`요양병원·의원에 입원하면 하루 ${care}입니다.`)
  for (const note of input.paybackNotes) points.push(`${note.company} 간병 페이백: ${note.text}`)
  return { headline, points }
}

export function summaryToText(summary: ProposalSummary): string {
  return [summary.headline, ...summary.points.map((p) => `• ${p}`)].filter(Boolean).join('\n')
}
