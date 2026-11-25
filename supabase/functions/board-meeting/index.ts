// SJ INVEST — 경영 회의실 (board-meeting, Claude 기반 주간 경영 자문 리포트)
//
// 사내 데이터 스냅샷을 받아, 대표님께 올리는 '주간 경영 회의 리포트'를 4개 팀
// 관점(기획/운영/영업·성장/개발)으로 작성한다.
//  - 입력: { context: 사내 데이터 스냅샷(≤4000자), week: 주차 표기 }
//  - 출력: { success, result: { overview, teams:[{key,name,insights,proposals}], decisions } }
// 키는 ANTHROPIC_API_KEY 시크릿(서버 전용). jarvis-brain 플러밍을 재사용한다.

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
    if (esc) { esc = false; continue }
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
  try { return JSON.parse(frag) as Record<string, unknown> } catch { /* repair */ }
  try { return JSON.parse(autoClose(text.slice(start))) as Record<string, unknown> } catch { return null }
}

const TEAMS: { key: string; name: string; focus: string }[] = [
  { key: 'plan', name: '기획팀', focus: '다음에 무엇을 만들어야 하는가 — 제품·기능 우선순위' },
  { key: 'ops', name: '운영팀', focus: '어떻게 더 잘 굴릴까 — 프로세스·규정·직원 운영 개선' },
  { key: 'sales', name: '영업·성장팀', focus: '매출·리쿠르팅·고객 — 성장을 위한 실행 액션' },
  { key: 'dev', name: '개발팀', focus: '기술·자동화 — 앱으로 더 줄일 수 있는 수작업' }
]

function buildSystem(week: string): string {
  const teamList = TEAMS.map((t) => `${t.key}(${t.name}: ${t.focus})`).join(', ')
  return [
    '당신은 SJ INVEST(보험 영업 조직, GA)의 "AI 경영 관리자"입니다. 대표님을 보좌해 주간 경영 회의를 주재하고, 그 결과를 한 장의 리포트로 올립니다. 한국어 존댓말, 간결하고 실질적으로.',
    `이번 회의 주차: ${week}.`,
    '',
    `아래 네 팀의 관점에서 각각 분석합니다: ${teamList}.`,
    '제공되는 "사내 데이터 스냅샷"의 실제 수치에 근거해 작성하고, 데이터에 없는 세부는 지어내지 말고 "확인 필요"로 표시하세요. 각 제안은 구체적이고 실행 가능해야 합니다(막연한 조언 금지).',
    '',
    '반드시 아래 JSON으로만 답하세요. 응답의 첫 글자는 { 여야 합니다 — 인사말·마크다운 코드펜스 금지.',
    '{"overview":"이번 주 전체 현황 2~3문장 요약(핵심 수치 포함)",',
    '"teams":[{"key":"plan","name":"기획팀","insights":["데이터로 본 현황·관찰 1~3개"],"proposals":["구체 실행 제안 1~3개"]}, ...네 팀 모두],',
    '"decisions":["대표님의 결정이 필요한 안건 2~4개(선택지가 있으면 함께)"]}',
    '',
    '규칙: teams는 반드시 plan, ops, sales, dev 네 팀을 이 순서로. 각 문장은 80자 이내. 숫자는 스냅샷 기준으로만.'
  ].join('\n')
}

interface TeamOut { key: string; name: string; insights: string[]; proposals: string[] }

function coerceTeams(raw: unknown): TeamOut[] {
  const arr = Array.isArray(raw) ? raw : []
  const byKey = new Map<string, Record<string, unknown>>()
  for (const t of arr) {
    const o = t as Record<string, unknown>
    if (typeof o?.key === 'string') byKey.set(o.key, o)
  }
  return TEAMS.map((t) => {
    const o = byKey.get(t.key) ?? {}
    const insights = (Array.isArray(o.insights) ? o.insights : []).map(String).filter(Boolean).slice(0, 4)
    const proposals = (Array.isArray(o.proposals) ? o.proposals : []).map(String).filter(Boolean).slice(0, 4)
    return { key: t.key, name: t.name, insights, proposals }
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // 호출자 인증 — 로그인한 직원만. anon 키만으로는 호출 불가 (AI 무단 사용·요금 남용 차단).
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

  let body: { context?: unknown; week?: unknown }
  try { body = await req.json() } catch { return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400) }

  const week = String(body.week ?? '').slice(0, 40) || '이번 주'
  const context = String(body.context ?? '').slice(0, 4000)
  if (!context.trim()) return json({ success: false, error: '데이터 스냅샷이 비어 있습니다.' }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        // 판단형 리포트 — 기본은 균형 모델, 환경변수로 상향 가능.
        model: Deno.env.get('BOARD_MEETING_MODEL') || 'claude-sonnet-5',
        max_tokens: 2600,
        system: `${buildSystem(week)}\n\n--- 사내 데이터 스냅샷 (이 수치에 근거해 작성) ---\n${context}`,
        messages: [{ role: 'user', content: `${week} 경영 회의 리포트를 위 JSON 형식으로 작성해 주세요.` }]
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
    if (!parsed) return json({ success: false, error: '리포트 생성 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502)
    const overview = String(parsed.overview ?? '').trim()
    const teams = coerceTeams(parsed.teams)
    const decisions = (Array.isArray(parsed.decisions) ? parsed.decisions : []).map(String).filter(Boolean).slice(0, 5)
    if (!overview && teams.every((t) => t.insights.length === 0 && t.proposals.length === 0)) {
      return json({ success: false, error: '리포트 내용이 비어 있습니다. 다시 시도해 주세요.' }, 502)
    }
    return json({ success: true, result: { overview, teams, decisions } })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '응답 시간이 초과되었습니다. 다시 시도해 주세요.' : '리포트 생성 중 오류가 발생했습니다.' }, 502)
  } finally {
    clearTimeout(timer)
  }
})
