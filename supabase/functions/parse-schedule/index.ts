// SJ INVEST — 자연어 일정 등록 파서 (parse-schedule)
//
// 입력(JSON): { text, today: 'YYYY-MM-DD', weekday: '수', customers?: string[] }
// 출력: { success, parsed: { type, customerName, date, time, location } }
// "내일 오후 2시 김민준 2차만남 강남역" → 구조화된 일정. 텍스트는 저장되지 않는다.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const VALID_TYPES = ['ap', 'meeting-1', 'meeting-2', 'meeting-3', 'closing', 'delivery', 'intro-meeting', 'meeting', 'personal']

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return json({ success: false, code: 'OPENAI_API_KEY_MISSING', error: 'OPENAI_API_KEY 시크릿이 없습니다.' }, 503)

  let body: { text?: unknown; today?: unknown; weekday?: unknown; customers?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const text = String(body.text ?? '').trim()
  if (!text) return json({ success: false, error: '등록할 일정 내용을 입력해주세요.' }, 400)
  const today = String(body.today ?? '').slice(0, 10)
  const weekday = String(body.weekday ?? '').slice(0, 2)
  const customers = Array.isArray(body.customers) ? body.customers.map((c) => String(c)).slice(0, 300) : []

  const SYSTEM_PROMPT = [
    '당신은 보험 설계사의 일정 비서입니다. 사용자가 말하듯 쓴 한 줄을 일정으로 변환합니다.',
    '아래 JSON 형식으로만 답하세요 (다른 텍스트 금지):',
    '{"type":"유형 키","customerName":"고객 이름 또는 null","date":"YYYY-MM-DD","time":"HH:MM","location":"장소/주소 또는 null"}',
    '',
    `오늘은 ${today} (${weekday}요일)입니다. "내일", "모레", "다음 주 목요일", "이번 주 금요일" 같은 상대 날짜를 이 기준으로 정확히 계산하세요.`,
    '유형 키는 반드시 이 중 하나: ap, meeting-1(1차만남), meeting-2(2차만남), meeting-3(3차만남), closing(클로징), delivery(증전), intro-meeting(소개만남), meeting(만남), personal(개인일정).',
    '유형 언급이 없으면 고객이 있으면 meeting, 없으면 personal.',
    '시간: "오후 2시"=14:00, "저녁 7시"=19:00, "아침 9시"=09:00. 시간 언급이 없으면 "10:00".',
    '30분 단위가 아니어도 말한 그대로 (예: 2시 20분 → 14:20).',
    customers.length > 0
      ? `등록된 고객 목록: ${customers.join(', ')} — 입력 속 이름이 이 목록의 이름과 같거나 그 일부면 목록의 정확한 이름으로 쓰세요. 목록에 없으면 입력된 이름 그대로.`
      : '',
    '장소/주소가 언급되면 location에 그대로. 없으면 null.',
    '지어내지 마세요 — 입력에 없는 정보는 null (시간만 예외적으로 10:00 기본).'
  ]
    .filter(Boolean)
    .join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Deno.env.get('PARSE_SCHEDULE_MODEL') || 'gpt-4o',
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 500) }
        ]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return json({ success: false, error: data?.error?.message || `OpenAI 오류 (HTTP ${r.status}).` }, 502)
    let parsed: { type?: unknown; customerName?: unknown; date?: unknown; time?: unknown; location?: unknown } = {}
    try {
      parsed = JSON.parse(String(data?.choices?.[0]?.message?.content ?? '{}'))
    } catch {
      return json({ success: false, error: '해석 결과 형식 오류.' }, 502)
    }
    const type = VALID_TYPES.includes(String(parsed.type)) ? String(parsed.type) : 'meeting'
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date)) ? String(parsed.date) : today
    const time = /^\d{2}:\d{2}$/.test(String(parsed.time)) ? String(parsed.time) : '10:00'
    const customerName = parsed.customerName ? String(parsed.customerName).slice(0, 30) : null
    const location = parsed.location ? String(parsed.location).slice(0, 120) : null
    return json({ success: true, parsed: { type, customerName, date, time, location } })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '해석 시간 초과. 다시 시도해 주세요.' : '해석 중 오류가 발생했습니다.' }, aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
})
