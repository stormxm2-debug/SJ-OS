// SJ INVEST — 건강기록 AI 요약/질문 (health-record-ai)
//
// 클라이언트가 RLS 권한 내에서 만든 **비식별 구조화 요약**(상병·방문수·수술·투약·기간)과
// (선택) 질문을 받아, 보수적인 한국어 분석·설명을 돌려준다.
//  - 입력: { summary: {...}, question?: string }
//  - 출력: { success, result: { answer } }
// 키는 ANTHROPIC_API_KEY 시크릿(jarvis-brain 과 동일). 대화는 메모리에서만 처리되고 저장되지 않는다.
// ⚠️ 이름·주민번호 등 직접 식별자는 클라이언트가 제외한 요약만 전송한다(프런트 buildHrAiSummary).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { safeUnderwritingContext, UNDERWRITING_INSTRUCTIONS } from './underwritingContext.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const SYSTEM = [
  '당신은 한국 보험 상담사를 돕는 보조자입니다. 입력으로 고객의 **건강기록 요약(비식별)**이 주어집니다.',
  '역할: 요약을 이해하기 쉽게 정리하고, 질문에 답합니다.',
  '원칙(반드시 지킬 것):',
  '- 입력에 있는 사실만 사용하고, 없는 진단·수술·투약을 지어내지 않는다. 모르면 "자료에 없음"이라고 말한다.',
  '- 의학적 진단·치료 권고를 하지 않는다. 보험 상담 관점의 **정리/확인 포인트**만 제시한다.',
  '- 병명·수술·투약 연결은 (진료일·기관) 매칭에 기반한 **추정**임을 전제로 말한다(확정 아님).',
  '- 금액·지급 여부를 단정하지 않는다. "약관·증빙 확인 필요"로 안내한다.',
  '- 한국어로, 간결한 문단/불릿으로. 과장 없이.',
  '출력은 사람이 읽기 좋은 평문(마크다운 불릿 허용). JSON 으로 감싸지 말 것.',
  UNDERWRITING_INSTRUCTIONS
].join('\n')

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // 호출자 인증 — 로그인한 직원만(anon 키만으로는 차단, AI 무단 사용 방지).
  {
    const su = Deno.env.get('SUPABASE_URL') ?? ''
    const sk = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const caller = su && sk ? createClient(su, sk, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } }) : null
    const uid = caller ? (await caller.auth.getUser()).data?.user?.id : null
    if (!uid) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ success: false, code: 'ANTHROPIC_API_KEY_MISSING', error: 'ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.' }, 503)

  let body: { summary?: unknown; question?: unknown; underwriting?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  if (!body.summary || typeof body.summary !== 'object') return json({ success: false, error: '건강기록 요약(summary)이 필요합니다.' }, 400)

  const summaryText = JSON.stringify(body.summary).slice(0, 12000)
  const question = String(body.question ?? '').trim().slice(0, 500)
  const underwritingText = JSON.stringify(safeUnderwritingContext(body.underwriting))
  const userMsg = question
    ? `아래는 고객 건강기록 비식별 요약(JSON)입니다.\n\n${summaryText}\n\n질문: ${question}\n\n요약을 바탕으로 답해 주세요.`
    : `아래는 고객 건강기록 비식별 요약(JSON)입니다.\n\n${summaryText}\n\n가입 심사에 영향을 줄 수 있는 기록과 확인할 사항만 간결하게 정리하세요. 자료가 부족하면 추가 확인 필요로 표시하세요.`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('HEALTH_RECORD_AI_MODEL') || 'claude-sonnet-5',
        max_tokens: 1800,
        system: SYSTEM,
        messages: [{ role: 'user', content: `${userMsg}\n\n선택 보험사 및 등록된 참고 인수·예외 기준(JSON):\n${underwritingText}` }]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || `Claude 오류 (HTTP ${r.status})`
      return json({ success: false, error: msg }, 502)
    }
    const blocks = (data as { content?: { type: string; text?: string }[] }).content ?? []
    const answer = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
    if (!answer) return json({ success: false, error: '응답이 비어 있습니다. 다시 시도해 주세요.' }, 502)
    return json({ success: true, result: { answer } })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '응답 시간이 초과되었습니다.' : 'AI 처리 중 오류가 발생했습니다.' }, 502)
  } finally {
    clearTimeout(timer)
  }
})
