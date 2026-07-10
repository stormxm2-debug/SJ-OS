// SJ INVEST — 보험 백과사전 AI 선생님 (insurance-tutor)
// 입력: { question } → { success, answer: { explanation, salesTip } }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const SYSTEM_PROMPT = [
  '당신은 대한민국 보험사(삼성화재 계열) 신입 설계사를 가르치는 친절한 선배입니다.',
  '질문에 대해 아래 JSON 형식으로만 답하세요 (다른 텍스트 금지):',
  '{"explanation":"신입도 이해하는 쉬운 설명 (3~6문장, 전문용어는 풋이해서)","salesTip":"실전 화법/영업 팁 1~2문장 (고객에게 이렇게 말해보세요 스타일)"}',
  '',
  '규칙:',
  '1) 쉽게 — 전문용어는 반드시 풋어서. 비유 환영.',
  '2) 정확하게 — 확실하지 않은 수치·약관 조항은 단정하지 말고 "상품마다 다름"을 명시.',
  '3) 보험·영업과 무관한 질문이면 explanation에 "보험/영업 관련 질문을 부탁드려요"라고 정중히 안내하고 salesTip은 빈 문자열.',
  '모두 한국어.'
].join('\n')

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // (보안 H1) 호출자 인증 — 로그인한 직원만. 번들 anon 키만으로는 호출 불가 (AI 무단 사용·요금 남용 차단).
  {
    const su = Deno.env.get('SUPABASE_URL') ?? ''
    const sk = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const caller = su && sk ? createClient(su, sk, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } }) : null
    const uid = caller ? (await caller.auth.getUser()).data?.user?.id : null
    if (!uid) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return json({ success: false, code: 'OPENAI_API_KEY_MISSING', error: 'OPENAI_API_KEY 시크릿이 없습니다.' }, 503)

  let body: { question?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const question = String(body.question ?? '').trim()
  if (!question) return json({ success: false, error: '질문을 입력해주세요.' }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35000)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Deno.env.get('INSURANCE_TUTOR_MODEL') || 'gpt-4o',
        temperature: 0.4,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question.slice(0, 500) }
        ]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return json({ success: false, error: data?.error?.message || `OpenAI 오류 (HTTP ${r.status}).` }, 502)
    let ans: { explanation?: unknown; salesTip?: unknown } = {}
    try {
      ans = JSON.parse(String(data?.choices?.[0]?.message?.content ?? '{}'))
    } catch {
      return json({ success: false, error: '답변 형식 오류.' }, 502)
    }
    return json({
      success: true,
      answer: {
        explanation: String(ans.explanation ?? '').slice(0, 1200),
        salesTip: String(ans.salesTip ?? '').slice(0, 400)
      }
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '답변 시간 초과. 다시 시도해 주세요.' : '답변 중 오류가 발생했습니다.' }, aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
})
