/**
 * 건강기록 AI 요약/질문 — health-record-ai 엣지함수 호출.
 *
 * coverageMixAi 와 동일한 방식: 사용자 세션 토큰으로 호출(미로그인/미구성 시 비활성).
 * ⚠️ 이름·주민번호 등 직접 식별자는 보내지 않는다 — buildHrAiSummary 의 비식별 요약만 전송.
 */
import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import { buildHrAiSummary, collectHrSections } from './summarize'
import type { HrUnderwritingContext } from './careWorkspace'

async function bearer(): Promise<string | undefined> {
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const data = (await client?.auth?.getSession())?.data
    return data?.session?.access_token
  } catch {
    return undefined
  }
}

export interface HrAiResult {
  ok: boolean
  answer?: string
  disabled?: boolean
  error?: string
}

/** 건강기록 result(원본) + 선택 질문 → AI 답변. 전송 전 비식별 요약으로 변환. */
export async function askHealthRecordAi(result: unknown, question?: string, context?: HrUnderwritingContext): Promise<HrAiResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, disabled: true, error: 'AI 기능은 로그인·서버 연결 후 사용할 수 있습니다.' }

  const summary = buildHrAiSummary(collectHrSections(result))
  if (!summary.diseases.length && !summary.totalVisits) {
    return { ok: false, error: '요약할 진료 내역이 없습니다.' }
  }

  const token = (await bearer()) ?? anon
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch(`${base}/health-record-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ summary, question: question?.trim() || undefined, underwriting: context ? {
        insurers: context.insurers,
        guides: context.guides.filter(g=>g.verified),
        exceptions: context.exceptions.filter(e=>e.verified).map(e=>({ insurer:e.insurer, disease:e.disease, productClass:e.productClass, minElapsed:e.minElapsed, treatmentPeriod:e.treatmentPeriod, surgery:e.surgery, note:e.note, updatedAt:e.updatedAt, verified:true }))
      } : undefined }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string; result?: { answer?: unknown } } | null
    if (res.status === 404) return { ok: false, disabled: true, error: 'AI 기능이 아직 서버에 설치되지 않았습니다.' }
    if (res.status === 503 || data?.code === 'ANTHROPIC_API_KEY_MISSING') return { ok: false, disabled: true, error: 'AI 키가 서버에 설정되지 않았습니다(담당자 설정 필요).' }
    if (res.status === 401) return { ok: false, disabled: true, error: '로그인 후 사용할 수 있습니다.' }
    if (!res.ok || !data?.success || !data.result) return { ok: false, error: data?.error ?? `AI 요청 실패 (HTTP ${res.status})` }
    const answer = String(data.result.answer ?? '').trim()
    if (!answer) return { ok: false, error: 'AI가 답변을 만들지 못했습니다.' }
    return { ok: true, answer }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'AI 응답 시간이 초과되었습니다.' : 'AI 서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}
