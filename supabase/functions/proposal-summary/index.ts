// SJ INVEST — 가입제안서 담보 정리 AI 요약 (proposal-summary, Claude 기반)
//
// 입력: 화면에서 이미 계산한 숫자만 받는다 — 보험사별 월 보험료, 항목별 일당(만원), 상황별 합계, 간병 페이백 문장.
//       고객 이름·파일명·제안서 원문은 받지 않는다.
// 출력: { success, result: { headline, companies: [{ company, points[] }] } } — 보험사별 "이 보험의 장점".
// 키는 ANTHROPIC_API_KEY 시크릿. 요청 내용은 메모리에서만 처리되고 저장·로그하지 않는다.

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
  '당신은 대한민국 보험 설계사가 고객에게 입원·간병 보험을 설명하도록 돕는 선배입니다.',
  '입력은 서로 비교하는 보험사 가입제안서에서 뽑아 이미 계산한 숫자입니다.',
  '금액을 그대로 읽어주지 말고, 각 보험의 "장점"을 고객이 바로 이해하도록 짧게 설명하세요.',
  '아래 JSON으로만 답하세요. 응답의 첫 글자는 반드시 { 이고, 인사말·마크다운·코드펜스 금지.',
  '{"headline":"비교 결론 한 줄 (예: 보험료는 A, 대학병원 입원 보장은 B가 강점) 60자 이내",',
  '"companies":[{"company":"보험사명(입력 그대로)","points":["이 보험의 장점 한 문장 (각 70자 이내)"]}]}',
  '',
  '규칙:',
  '1) companies는 입력 순서(보험료 낮은 순) 그대로, 회사마다 points 2~4개.',
  '2) 장점은 다른 제안서와 비교해 더 나은 점을 우선합니다: 더 저렴한 보험료, 특정 상황(일반·종합·대학병원 1인실·간호간병·요양병원)에서 하루 더 많이 받는 점, 다른 곳에 없는 보장, 간병 페이백 조건.',
  '3) 숫자는 장점을 뒷받침할 때만 짧게 쓰세요 (예: "대학병원 1인실 입원 시 하루 31만원으로 가장 든든합니다").',
  '4) 입력에 없는 숫자·약관 내용·보장은 절대 지어내지 마세요. 값이 0이거나 없는 항목은 장점으로 쓰지 않습니다.',
  '5) 단위: 보험료는 원(월 38,280원), 일당·합계는 만원. 합계는 회사별 금액이며 회사끼리 더하지 않습니다.',
  '6) 쉬운 존댓말. 전문용어는 풀어서. 과장·단정·불안 조성·다른 회사 비방 금지.',
  '모두 한국어.'
].join('\n')

interface CompanyInput {
  company?: unknown
  monthlyPremium?: unknown
  dailyByCategory?: unknown
  payback?: unknown
}

const clip = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function buildUserText(body: Record<string, unknown>): string | null {
  const companies = (Array.isArray(body.companies) ? body.companies : []).slice(0, 12) as CompanyInput[]
  if (companies.length === 0) return null

  const lines: string[] = ['[보험사별 (월 보험료 낮은 순)]']
  for (const c of companies) {
    const premium = Number(c.monthlyPremium)
    const head = `- ${clip(c.company, 30)}: 월 보험료 ${Number.isFinite(premium) && premium > 0 ? `${premium.toLocaleString('ko-KR')}원` : '확인 필요'}${c.payback ? ', 간병 페이백 있음' : ''}`
    const daily = c.dailyByCategory && typeof c.dailyByCategory === 'object' ? (c.dailyByCategory as Record<string, Record<string, unknown>>) : {}
    const parts = Object.entries(daily)
      .slice(0, 20)
      .map(([category, sides]) => {
        const s = Number(sides?.['상해'])
        const d = Number(sides?.['질병'])
        const text = [s ? `상해 ${s}` : '', d ? `질병 ${d}` : ''].filter(Boolean).join('/')
        return text ? `${clip(category, 20)} ${text}만원` : ''
      })
      .filter(Boolean)
    lines.push(parts.length ? `${head} — ${parts.join(', ')}` : head)
  }

  const summary = (Array.isArray(body.summary) ? body.summary : []).slice(0, 20) as Record<string, unknown>[]
  if (summary.length) {
    lines.push('', '[상황별 하루 입원 시 받는 금액 (보험사별, 만원)]')
    for (const row of summary) {
      const byCompany = row.byCompany && typeof row.byCompany === 'object' ? (row.byCompany as Record<string, Record<string, unknown>>) : {}
      const parts = Object.entries(byCompany)
        .slice(0, 12)
        .map(([company, sides]) => {
          const s = Number(sides?.['상해']) || 0
          const d = Number(sides?.['질병']) || 0
          return s || d ? `${clip(company, 30)} 상해 ${s}/질병 ${d}` : ''
        })
        .filter(Boolean)
      if (parts.length) lines.push(`- ${clip(row.label, 30)}: ${parts.join(', ')}`)
    }
  }

  const notes = (Array.isArray(body.paybackNotes) ? body.paybackNotes : []).slice(0, 12) as Record<string, unknown>[]
  if (notes.length) {
    lines.push('', '[간병 페이백 조건]')
    for (const note of notes) lines.push(`- ${clip(note.company, 30)}: ${clip(note.text, 300)}`)
  }
  return lines.join('\n').slice(0, 6000)
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // 호출자 인증 — 로그인한 직원만 (AI 무단 사용·요금 남용 차단).
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const userText = buildUserText(body)
  if (!userText) return json({ success: false, error: '요약할 보험사 정보가 없습니다.' }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('PROPOSAL_SUMMARY_MODEL') || 'claude-sonnet-5',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || `Claude 오류 (HTTP ${r.status})`
      return json({ success: false, error: msg }, 502)
    }
    const blocks = (data as { content?: { type: string; text?: string }[] }).content ?? []
    const parsed = parseJson(blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''))
    if (!parsed) return json({ success: false, error: '요약 형식 오류 — 다시 시도해 주세요.' }, 502)
    const companies = (Array.isArray(parsed.companies) ? parsed.companies : [])
      .slice(0, 12)
      .map((c) => {
        const item = (c ?? {}) as Record<string, unknown>
        const points = (Array.isArray(item.points) ? item.points : []).map((p) => clip(p, 200)).filter(Boolean).slice(0, 5)
        return { company: clip(item.company, 30), points }
      })
      .filter((c) => c.company && c.points.length)
    return json({ success: true, result: { headline: clip(parsed.headline, 150), companies } })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '요약 시간이 초과되었습니다. 다시 시도해 주세요.' : '요약 중 오류가 발생했습니다.' }, aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
})
