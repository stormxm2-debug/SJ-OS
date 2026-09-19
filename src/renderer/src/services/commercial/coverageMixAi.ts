/**
 * 조합 설계안 "왜 좋은지" 설명 — AI 3가지 + 서버 없이 쓰는 기본 설명.
 *
 * proposalSummaryAi.ts 와 같은 방식이다. AI(coverage-mix-summary edge function)에는
 * 화면에서 이미 계산한 숫자와 회사명만 보낸다. 고객 이름·파일명·제안서 원문은 보내지 않는다.
 * 서버에 연결할 수 없거나 함수가 아직 없으면 숫자 비교로 만든 기본 설명을 그대로 쓴다.
 */

import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import type { MixResult } from './coverageMix'

/** 설명은 한 번에 3가지. 화면·엑셀·AI 프롬프트가 모두 이 값을 따른다. */
export const POINT_COUNT = 3

export interface MixExplanation {
  headline: string
  points: string[]
  source: 'ai' | 'basic'
}

const won = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`

/** 받침에 맞는 조사(이/가). */
const iga = (word: string): string => {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '이' : '가'
}

/* ---------- AI에 보내는 입력 ---------- */

export interface MixSummaryInput {
  planLabel: string
  mixPremium: number
  savedVsSingle: number | null
  cheapestSingle: { company: string; premium: number } | null
  usedCompanies: string[]
  byCompany: { company: string; premium: number; rowCount: number }[]
  rows: { label: string; company: string; premiumWon: number | null; amountManwon: number | null; rivals: number }[]
}

export function buildMixInput(planLabel: string, mix: MixResult): MixSummaryInput {
  return {
    planLabel,
    mixPremium: mix.mixPremium,
    savedVsSingle: mix.savedVsSingle,
    cheapestSingle: mix.cheapestSingle,
    usedCompanies: mix.usedCompanies,
    byCompany: mix.byCompany,
    rows: mix.rows
      .filter((r) => r.best)
      .map((r) => ({
        label: r.label,
        company: r.best!.company,
        premiumWon: r.best!.premiumWon,
        amountManwon: r.best!.amountManwon,
        rivals: r.candidates.length
      }))
  }
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

export async function requestMixExplanation(
  input: MixSummaryInput
): Promise<{ ok: boolean; explanation?: MixExplanation; error?: string }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: 'AI 설명은 서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60000)
  try {
    const token = (await bearer()) ?? anon
    const res = await fetch(`${base}/coverage-mix-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; error?: string; result?: { headline?: unknown; points?: unknown } }
      | null
    if (res.status === 404) return { ok: false, error: 'AI 설명 기능이 아직 서버에 설치되지 않았습니다.' }
    if (!res.ok || !data?.success || !data.result) return { ok: false, error: data?.error ?? `AI 설명 실패 (HTTP ${res.status})` }
    const points = (Array.isArray(data.result.points) ? data.result.points : []).map(String).map((p) => p.trim()).filter(Boolean)
    if (points.length === 0) return { ok: false, error: 'AI가 설명을 만들지 못했습니다.' }
    return {
      ok: true,
      explanation: { headline: String(data.result.headline ?? '').trim(), points: points.slice(0, POINT_COUNT), source: 'ai' }
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'AI 설명 시간이 초과되었습니다.' : 'AI 설명 서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/* ---------- 기본 설명(서버 없이 숫자 비교) ---------- */

/**
 * 조합 설계안의 장점 3가지를 숫자에서 뽑는다. 근거가 없는 말은 만들지 않고,
 * 3가지가 안 나오면 나온 만큼만 돌려준다.
 */
export function buildBasicExplanation(planLabel: string, mix: MixResult): MixExplanation {
  const points: string[] = []
  const compared = mix.rows.filter((r) => !r.soleOffer && r.candidates.length > 1)

  // 1) 얼마나 아끼는지 — 고객이 가장 먼저 묻는 것
  if (mix.savedVsSingle !== null && mix.savedVsSingle > 0 && mix.cheapestSingle) {
    const yearly = mix.savedVsSingle * 12
    points.push(
      `한 회사로만 넣을 때 가장 저렴한 ${mix.cheapestSingle.company}(월 ${won(mix.cheapestSingle.premium)})보다 ` +
        `월 ${won(mix.savedVsSingle)} 저렴합니다. 1년이면 ${won(yearly)}을 아낍니다.`
    )
  } else if (mix.mixPremium > 0) {
    points.push(`담보마다 가장 저렴한 회사로 골라 월 ${won(mix.mixPremium)}으로 맞췄습니다.`)
  }

  // 2) 실제로 어떻게 쪼갰는지 — 담보를 예로 들어 보여준다
  if (mix.usedCompanies.length > 1) {
    const examples = compared
      .filter((r) => r.best)
      .slice(0, 3)
      .map((r) => `${r.label}는 ${r.best!.company}`)
    if (examples.length) {
      points.push(
        `${examples.join(', ')} — 담보마다 가장 저렴한 회사로 나눠 ${mix.usedCompanies.length}개 보험사를 조합했습니다.`
      )
    }
  } else if (mix.usedCompanies.length === 1) {
    const only = mix.usedCompanies[0]
    points.push(`담보별로 비교한 결과 ${only}${iga(only)} 모든 담보에서 가장 저렴해 한 회사로 정리했습니다.`)
  }

  // 3) 비교 근거 — 몇 개를 어떤 기준으로 비교했는지
  const bigGap = compared
    .filter((r) => r.best?.premiumWon != null)
    .map((r) => {
      const prices = r.candidates.map((c) => c.premiumWon).filter((v): v is number => v !== null)
      return { label: r.label, gap: prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0 }
    })
    .sort((a, b) => b.gap - a.gap)[0]

  if (bigGap && bigGap.gap > 0) {
    points.push(
      `같은 담보라도 회사마다 보험료 차이가 커서 ${bigGap.label}는 월 ${won(bigGap.gap)}까지 벌어집니다. ` +
        `가입금액 1,000만원당 보험료로 비교해 골랐습니다.`
    )
  } else if (compared.length > 0) {
    points.push(`담보 ${compared.length}개를 가입금액 1,000만원당 보험료로 비교해 저렴한 쪽을 골랐습니다.`)
  }

  const headline =
    mix.savedVsSingle !== null && mix.savedVsSingle > 0
      ? `${planLabel} — 담보별로 쪼개 월 ${won(mix.savedVsSingle)} 절약`
      : `${planLabel} — 담보마다 가장 저렴한 회사로 구성`

  return { headline, points: points.slice(0, POINT_COUNT), source: 'basic' }
}

/** AI를 먼저 시도하고, 안 되면 기본 설명으로 넘어간다. 실패해도 설명은 항상 나온다. */
export async function explainMix(
  planLabel: string,
  mix: MixResult
): Promise<{ explanation: MixExplanation; error?: string }> {
  const basic = buildBasicExplanation(planLabel, mix)
  if (mix.rows.length === 0) return { explanation: basic }
  const res = await requestMixExplanation(buildMixInput(planLabel, mix))
  if (res.ok && res.explanation) {
    return { explanation: { ...res.explanation, headline: res.explanation.headline || basic.headline } }
  }
  return { explanation: basic, error: res.error }
}

export function explanationToText(explanation: MixExplanation): string {
  return [explanation.headline, ...explanation.points.map((p, i) => `${i + 1}. ${p}`)].filter(Boolean).join('\n')
}
