// SJ INVEST — 자비스 브레인 (jarvis-brain, Claude 기반 자유 대화 + 실행 액션)
//
// 규칙 기반 로컬 라우터가 처리하지 못한 명령을 받아 챗GPT처럼 자유롭게 답하고,
// 필요하면 앱 실행 액션(화면 이동)과 후속 추천 명령을 함께 반환한다.
//  - 입력: 최근 대화(messages ≤ 12턴) + 앱 모드(staff/ceo)
//  - 출력: { reply, navigate: 허용된 라우트 | null, suggested: [...] }
// 키는 ANTHROPIC_API_KEY 시크릿. 대화는 메모리에서만 처리되고 저장되지 않는다.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** 문자열/이스케이프를 인지하며 괄호 스택을 계산해, 잘린 JSON을 자동으로 닫는다. */
function autoClose(fragment: string): string {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of fragment) {
    if (esc) {
      esc = false
      continue
    }
    if (inStr) {
      if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let out = fragment
  if (inStr) out += '"'
  while (stack.length > 0) out += stack.pop()
  return out
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const frag = text.slice(start, text.lastIndexOf('}') > start ? text.lastIndexOf('}') + 1 : undefined)
  try {
    return JSON.parse(frag) as Record<string, unknown>
  } catch {
    /* try repair */
  }
  try {
    return JSON.parse(autoClose(text.slice(start))) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 자비스가 이동시킬 수 있는 화면 — 모드별 허용 라우트 (라벨은 프롬프트 안내용). */
const STAFF_NAV: Record<string, string> = {
  'staff-home': '홈',
  attendance: '출퇴근',
  customer: '고객관리',
  consultation: '상담기록',
  schedule: '일정관리',
  'shared-schedule': '공유 일정',
  performance: '매출현황',
  'sales-activity': '영업활동',
  'insurance-analysis': '보험분석',
  'claim-assistant': '보험금 청구비서',
  wiki: '보험 백과사전',
  underwriting: '인수 가이드(질병별 기준표)',
  'pre-underwriting': 'AI 사전심사(가입 가능성 예측)',
  contacts: '매니저 연락처',
  notice: '공지사항'
}

const CEO_NAV: Record<string, string> = {
  ...STAFF_NAV,
  dashboard: 'CEO 대시보드',
  autopilot: '오토파일럿',
  cto: 'CTO룸',
  qa: 'QA 센터',
  release: '릴리즈센터',
  devops: 'DevOps 센터',
  pm: 'PM 플래너',
  backlog: '제품 백로그',
  workers: 'AI 직원',
  projects: '프로젝트',
  approvals: '승인센터',
  'app-builder': '앱 빌더',
  devprompt: '개발 프롬프트 센터',
  'staff-overview': '직원 현황',
  'staff-table': '전 직원 정리표',
  'registration-admin': '고객등록 관리'
}

function buildSystem(mode: 'staff' | 'ceo'): string {
  const nav = mode === 'ceo' ? CEO_NAV : STAFF_NAV
  const navList = Object.entries(nav)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ')
  return [
    '당신은 "자비스" — SJ INVEST(보험 영업 조직, GA)의 AI 업무 어시스턴트입니다. 아이언맨의 자비스처럼 유능하고 신뢰감 있게, 한국어 존댓말로 대화합니다.',
    mode === 'ceo'
      ? '지금 대화 상대는 대표님입니다. 경영·조직·개발 관점의 질문에도 깊이 있게 답하세요.'
      : '지금 대화 상대는 보험설계사(FC)입니다. 보험 상품·화법·고객 관리·일정 등 실무를 돕습니다.',
    '',
    '전문 분야: 보험(생명/손해/제3보험) 지식, 영업 화법과 반론 극복, 고객 관리 전략, 문서·카톡 문안 작성, 일반 상식과 업무 조언.',
    '',
    '반드시 아래 JSON으로만 답하세요. 응답의 첫 글자는 { 여야 합니다 — 인사말·마크다운 코드펜스 금지.',
    '{"reply":"사용자에게 보여줄 답변 (자연스러운 대화체, 필요하면 줄바꿈 \\n 사용, 800자 이내)",',
    '"navigate":"사용자의 의도가 특정 화면으로 가고 싶은 것일 때만 아래 목록의 라우트 키, 아니면 null",',
    '"suggested":["대화 맥락에 맞는 후속 명령/질문 추천 2~4개 (각 20자 이내)"]}',
    '',
    `이동 가능한 화면 (navigate에 키만 사용): ${navList}`,
    '',
    '규칙:',
    '1) 모르는 것은 모른다고 말하고 확인 방법을 안내. 사내 데이터 질문은 "사내 실시간 데이터 스냅샷"이 제공된 범위에서만 답하고, 스냅샷이 없거나 범위 밖이면 정확한 화면으로 navigate를 제안하며 안내.',
    '2) 보험 관련 답변은 일반론임을 필요시 명시 (상품·심사는 보험사별로 다름).',
    '3) 답변은 간결하게 — 핵심 먼저, 불필요한 서론 금지.',
    '4) navigate는 사용자가 이동/실행을 원할 때만. 단순 질문에는 null.'
  ].join('\n')
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ success: false, code: 'ANTHROPIC_API_KEY_MISSING', error: 'ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.' }, 503)
  }

  let body: { messages?: unknown; mode?: unknown; context?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const mode: 'staff' | 'ceo' = body.mode === 'ceo' ? 'ceo' : 'staff'
  // 사내 실시간 데이터 스냅샷 (클라이언트가 RLS 권한 범위에서 조회해 전달).
  const context = String(body.context ?? '').slice(0, 4000)
  const raw = Array.isArray(body.messages) ? body.messages : []
  const messages: ChatMessage[] = raw
    .map((m) => {
      const o = m as Record<string, unknown>
      const role = o.role === 'assistant' ? 'assistant' : 'user'
      const content = String(o.content ?? '').slice(0, 2000)
      return { role, content } as ChatMessage
    })
    .filter((m) => m.content.trim().length > 0)
    .slice(-12)
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return json({ success: false, error: '대화 메시지가 필요합니다.' }, 400)
  }
  // Anthropic은 user로 시작하는 교대 메시지를 요구 — 앞쪽 assistant 잔여를 제거.
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // 대화형은 응답 속도가 생명 — 판단형(opus)이 아닌 고속 모델 기본.
        model: Deno.env.get('JARVIS_BRAIN_MODEL') || 'claude-sonnet-5',
        max_tokens: 1500,
        system: context
          ? `${buildSystem(mode)}\n\n--- 사내 실시간 데이터 스냅샷 (아래 범위의 질문은 이 데이터로 정확히 답하고, 조회 시각을 함께 언급. 스냅샷에 없는 세부는 지어내지 말고 해당 화면 이동을 안내) ---\n${context}`
          : buildSystem(mode),
        messages
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || `Claude 오류 (HTTP ${r.status})`
      return json({ success: false, error: msg }, 502)
    }
    const blocks = (data as { content?: { type: string; text?: string }[] }).content ?? []
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    const parsed = parseJson(text)
    const nav = mode === 'ceo' ? CEO_NAV : STAFF_NAV
    // JSON 파싱 실패 시에도 대화는 살린다 — 원문을 reply로.
    const reply = String(parsed?.reply ?? text).trim()
    if (!reply) return json({ success: false, error: '응답이 비어 있습니다. 다시 시도해 주세요.' }, 502)
    const navigate = typeof parsed?.navigate === 'string' && nav[parsed.navigate] ? parsed.navigate : null
    const suggested = (Array.isArray(parsed?.suggested) ? parsed.suggested : []).map(String).filter(Boolean).slice(0, 4)
    return json({ success: true, result: { reply, navigate, suggested } })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '응답 시간이 초과되었습니다. 다시 시도해 주세요.' : '자비스 브레인 처리 중 오류가 발생했습니다.' }, 502)
  } finally {
    clearTimeout(timer)
  }
})
