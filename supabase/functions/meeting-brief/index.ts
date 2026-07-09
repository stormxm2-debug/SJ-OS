// SJ INVEST — 미팅 메모 AI 비서 (meeting-brief)
//
// 입력(JSON): { memo, typeLabel, customerName? }
// 출력: { success, brief: { summary, todos[], next?: { type, suggestion } } }
// 메모는 메모리에서만 분석되고 저장되지 않는다. OPENAI_API_KEY 시크릿 재사용.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// 영업 프로세스 진행 순서: 다음 일정 제안의 기준.
const SYSTEM_PROMPT = [
  '당신은 대한민국 보험 영업(삼성화재 계열) 설계사의 유능한 비서입니다.',
  '설계사가 방금 끝낸 미팅 메모를 읽고 아래 JSON 형식으로만 답하세요 (다른 텍스트 금지).',
  '',
  '{"summary":"미팅 핵심 요약 1~2문장","todos":["준비/처리할 일 (최대 5개, 없으면 빈 배열)"],"next":{"type":"다음 일정 유형 키","suggestion":"다음 일정 제안 한 문장"}}',
  '',
  '규칙:',
  '1) summary는 반드시 메모에 나온 구체 내용(상품명·금액·고객 니즈·특이사항)을 담으세요. "논의하였습니다" 같은 일반 문장 금지.',
  '1-b) 메모에 없는 내용은 절대 지어내지 마세요. 메모에 적힌 사실만 사용하고, 숫자(금액·나이·날짜)는 메모 표기 그대로 옮기세요.',
  '2) todos는 메모에서 실제로 도출되는 준비/처리 항목만. 각 항목은 구체적으로 (예: "종신 리모델링 설계안 준비", "배우자 실손 견적").',
  '3) 다음 일정 유형 키는 반드시 이 중 하나: ap, meeting-1, meeting-2, meeting-3, closing, delivery, intro-meeting, meeting',
  '   키↔한글: ap=AP, meeting-1=1차만남, meeting-2=2차만남, meeting-3=3차만남, closing=클로징, delivery=증전, intro-meeting=소개만남, meeting=만남',
  '4) 일반 진행 순서: ap → meeting-1 → meeting-2 → meeting-3 → closing → delivery(증권 전달). 현재 미팅 유형의 다음 단계를 기본으로 제안.',
  '5) suggestion에는 선택한 유형의 한글 이름을 그대로 쓰고, 메모에 시기·시간 언급(예: 다음 주 화요일 저녁 7시)이 있으면 반드시 포함하세요. 예: "다음 주 화요일 저녁 7시 3차만남 — 리모델링 설계안 지참"',
  '6) 다음 일정을 제안할 근거가 전혀 없으면 next를 null로.',
  '모두 한국어로, 고객에게 보여도 될 정중한 표현으로 쓰세요.'
].join('\n')

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return json({ success: false, code: 'OPENAI_API_KEY_MISSING', error: 'OPENAI_API_KEY 시크릿이 없습니다.' }, 503)

  let body: { memo?: unknown; typeLabel?: unknown; customerName?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const memo = String(body.memo ?? '').trim()
  if (!memo) return json({ success: false, error: '분석할 메모가 없습니다.' }, 400)
  const typeLabel = String(body.typeLabel ?? '만남').slice(0, 20)
  const customerName = String(body.customerName ?? '').slice(0, 30)

  const user = [
    `방금 끝난 미팅 유형: ${typeLabel}`,
    customerName ? `고객: ${customerName}` : '',
    '',
    '--- 미팅 메모 ---',
    memo.slice(0, 4000)
  ]
    .filter(Boolean)
    .join('\n')

  const model = Deno.env.get('MEETING_BRIEF_MODEL') || 'gpt-4o'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 40000)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 800,
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
    let brief: { summary?: unknown; todos?: unknown; next?: { type?: unknown; suggestion?: unknown } | null } = {}
    try {
      brief = JSON.parse(String(data?.choices?.[0]?.message?.content ?? '{}'))
    } catch {
      return json({ success: false, error: '분석 결과 형식 오류.' }, 502)
    }
    const VALID_TYPES = ['ap', 'meeting-1', 'meeting-2', 'meeting-3', 'closing', 'delivery', 'intro-meeting', 'meeting']
    const nextType = brief.next && VALID_TYPES.includes(String(brief.next.type)) ? String(brief.next.type) : 'meeting'
    return json({
      success: true,
      brief: {
        summary: String(brief.summary ?? '').slice(0, 500),
        todos: Array.isArray(brief.todos) ? brief.todos.map((t) => String(t).slice(0, 120)).filter(Boolean).slice(0, 5) : [],
        next:
          brief.next && String(brief.next.suggestion ?? '').trim()
            ? { type: nextType, suggestion: String(brief.next.suggestion).slice(0, 200) }
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
