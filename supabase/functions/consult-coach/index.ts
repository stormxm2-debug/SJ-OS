// SJ INVEST — 상담 AI 코치 (consult-coach)
// 입력: { summary, typeLabel, customer?: {name,age,gender,medicalHistory,familyCount}, history?: string[] }
// 출력: { success, coach: { needs, approach, nextAction, next?: {type, suggestion} } }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const VALID_TYPES = ['ap', 'meeting-1', 'meeting-2', 'meeting-3', 'closing', 'delivery', 'intro-meeting', 'meeting']

const SYSTEM_PROMPT = [
  '당신은 대한민국 보험 영업(삼성화재 계열) 20년차 베테랑 영업 코치입니다.',
  '설계사의 상담 요약을 읽고 아래 JSON 형식으로만 답하세요 (다른 텍스트 금지):',
  '{"needs":"고객 니즈 핵심 1~2문장","approach":"추천 접근 방식·화법 2~3문장 (구체적으로)","nextAction":"설계사가 바로 실행할 다음 액션 한 줄","next":{"type":"일정 유형 키","suggestion":"다음 일정 제안 한 문장"}}',
  '',
  '규칙:',
  '1) 요약·고객 정보·과거 상담 이력에 있는 사실만 근거로. 지어내기 금지.',
  '2) approach는 실전적으로: 어떤 순서로 말을 꺼내고, 어떤 상품 방향이 맞는지. 병력이 있으면 유병자(간편심사) 상품 검토를 언급.',
  '3) nextAction은 바로 실행 가능한 한 줄 (예: "기존 증권 수거 → 리모델링 설계안 → 다음 주 2차만남").',
  '4) next.type은 반드시 이 중 하나: ap, meeting-1, meeting-2, meeting-3, closing, delivery, intro-meeting, meeting (키↔한글: 1·2·3차만남, 클로징, 증전, 소개만남, 만남). 제안할 근거 없으면 next를 null.',
  '5) 과거 상담 이력이 있으면 흐름을 이어서 조언 (같은 말 반복 금지).',
  '모두 한국어, 정중하고 구체적으로.'
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

  let body: {
    summary?: unknown
    typeLabel?: unknown
    customer?: { name?: unknown; age?: unknown; gender?: unknown; medicalHistory?: unknown; familyCount?: unknown } | null
    history?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const summary = String(body.summary ?? '').trim()
  if (!summary) return json({ success: false, error: '분석할 상담 요약이 없습니다.' }, 400)

  const c = body.customer ?? null
  const custLines = c
    ? [
        `고객: ${String(c.name ?? '').slice(0, 30)}`,
        c.age ? `나이: 만 ${Number(c.age)}세` : '',
        c.gender ? `성별: ${String(c.gender).slice(0, 2)}` : '',
        c.medicalHistory ? `병력: ${String(c.medicalHistory).slice(0, 300)}` : '',
        c.familyCount ? `가족 구성원: ${Number(c.familyCount)}명 (세대 등록 기준)` : ''
      ].filter(Boolean)
    : []
  const history = Array.isArray(body.history) ? body.history.map((h) => String(h).slice(0, 300)).slice(0, 3) : []

  const user = [
    `상담 유형: ${String(body.typeLabel ?? '상담').slice(0, 20)}`,
    ...custLines,
    history.length > 0 ? `\n--- 과거 상담 이력 (최근순) ---\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : '',
    '',
    '--- 이번 상담 요약 ---',
    summary.slice(0, 3000)
  ]
    .filter(Boolean)
    .join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 40000)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Deno.env.get('CONSULT_COACH_MODEL') || 'gpt-4o',
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user }
        ]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return json({ success: false, error: data?.error?.message || `OpenAI 오류 (HTTP ${r.status}).` }, 502)
    let coach: { needs?: unknown; approach?: unknown; nextAction?: unknown; next?: { type?: unknown; suggestion?: unknown } | null } = {}
    try {
      coach = JSON.parse(String(data?.choices?.[0]?.message?.content ?? '{}'))
    } catch {
      return json({ success: false, error: '분석 결과 형식 오류.' }, 502)
    }
    const nextType = coach.next && VALID_TYPES.includes(String(coach.next.type)) ? String(coach.next.type) : 'meeting'
    return json({
      success: true,
      coach: {
        needs: String(coach.needs ?? '').slice(0, 400),
        approach: String(coach.approach ?? '').slice(0, 800),
        nextAction: String(coach.nextAction ?? '').slice(0, 400),
        next:
          coach.next && String(coach.next.suggestion ?? '').trim()
            ? { type: nextType, suggestion: String(coach.next.suggestion).slice(0, 200) }
            : null
      }
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '분석 시간 초과. 다시 시도해 주세요.' : '분석 중 오류가 발생했습니다.' }, aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
})
