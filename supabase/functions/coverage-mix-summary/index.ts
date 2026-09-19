// SJ INVEST — 조합 설계안 "왜 좋은지" 설명 (coverage-mix-summary, Claude 기반)
//
// 입력: 화면에서 이미 계산한 숫자만 받는다 — 플랜명, 담보별로 고른 회사와 보험료, 조합 합계,
//       한 회사로만 넣을 때와의 차액. 고객 이름·파일명·제안서 원문은 받지 않는다.
// 출력: { success, result: { headline, points[3] } } — 이 조합이 왜 좋은지 3가지.
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

/** 설명 개수. 화면(coverageMixAi.POINT_COUNT)과 같은 값을 쓴다. */
const POINT_COUNT = 3

const SYSTEM_PROMPT = [
  '당신은 대한민국 보험 설계사가 고객에게 "여러 보험사를 조합한 설계안"을 설명하도록 돕는 선배입니다.',
  '입력은 여러 가입제안서를 담보별로 비교해, 담보마다 가장 저렴한 회사를 고른 결과입니다.',
  '이 조합 설계안이 왜 좋은지를 고객이 바로 이해하도록 짧게 설명하세요.',
  '아래 JSON으로만 답하세요. 응답의 첫 글자는 반드시 { 이고, 인사말·마크다운·코드펜스 금지.',
  `{"headline":"한 줄 결론 (60자 이내)","points":["장점 한 문장 (각 90자 이내)"]}`,
  '',
  '규칙:',
  `1) points 는 정확히 ${POINT_COUNT}개입니다. 근거가 부족하면 억지로 늘리지 말고 있는 사실만 다르게 조명하세요.`,
  '2) 우선순위: ① 한 회사로만 넣을 때보다 얼마나 저렴한지(월·연 환산) ② 어떤 담보를 어느 회사로 나눴는지 예시 ③ 같은 담보인데 회사별 보험료 차이가 크다는 점.',
  '3) 숫자는 입력에 있는 값만 씁니다. 입력에 없는 보험료·가입금액·보장내용·약관은 절대 지어내지 마세요.',
  '4) 비교 기준은 "가입금액 1,000만원당 월 보험료"입니다. 보험료만 싸다고 좋다고 말하지 마세요.',
  '5) 단위: 보험료는 원(월 38,280원). 회사명은 입력 그대로 씁니다.',
  '6) 쉬운 존댓말. 전문용어는 풀어서. 과장·단정·불안 조성·특정 회사 비방 금지.',
  '7) 조합이 한 회사로만 구성됐다면 "나눴다"고 하지 말고, 비교 결과 그 회사가 가장 저렴했다고 설명하세요.',
  '모두 한국어.'
].join('\n')

const clip = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const wonText = (value: unknown): string => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('ko-KR')}원` : '확인 필요'
}

interface MixRowInput {
  label?: unknown
  company?: unknown
  premiumWon?: unknown
  amountManwon?: unknown
  rivals?: unknown
}

function buildUserText(body: Record<string, unknown>): string | null {
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 40) as MixRowInput[]
  if (rows.length === 0) return null

  const lines: string[] = [`[플랜] ${clip(body.planLabel, 30) || '담보 조합'}`]

  const mixPremium = Number(body.mixPremium)
  lines.push(`[조합 설계안 월 보험료] ${wonText(mixPremium)}`)

  const single = (body.cheapestSingle ?? null) as { company?: unknown; premium?: unknown } | null
  const saved = Number(body.savedVsSingle)
  if (single?.company && Number.isFinite(saved)) {
    lines.push(
      `[한 회사로만 넣을 때 가장 저렴한 곳] ${clip(single.company, 30)} ${wonText(single.premium)}` +
        ` → 조합이 월 ${wonText(saved)} ${saved > 0 ? '저렴' : '비쌈'}`
    )
  } else {
    lines.push('[한 회사로만 넣기] 모든 담보를 한 회사에서 채울 수 있는 곳이 없어 비교하지 않았습니다.')
  }

  const used = (Array.isArray(body.usedCompanies) ? body.usedCompanies : []).map((c) => clip(c, 30)).filter(Boolean)
  if (used.length) lines.push(`[조합에 들어간 보험사] ${used.join(', ')} (${used.length}곳)`)

  lines.push('', '[담보별로 고른 회사]')
  for (const row of rows) {
    const amount = Number(row.amountManwon)
    const rivals = Number(row.rivals)
    lines.push(
      `- ${clip(row.label, 40)}: ${clip(row.company, 30)} / 월 ${wonText(row.premiumWon)}` +
        (Number.isFinite(amount) && amount > 0 ? ` / 가입금액 ${amount.toLocaleString('ko-KR')}만원` : '') +
        (Number.isFinite(rivals) && rivals > 1 ? ` / 비교한 회사 ${rivals}곳` : ' / 이 회사에만 있는 담보')
    )
  }

  const byCompany = (Array.isArray(body.byCompany) ? body.byCompany : []).slice(0, 12) as {
    company?: unknown
    premium?: unknown
    rowCount?: unknown
  }[]
  if (byCompany.length) {
    lines.push('', '[회사별 단독 합계 — 그 회사가 가진 담보만 더한 값]')
    for (const c of byCompany) {
      lines.push(`- ${clip(c.company, 30)}: ${wonText(c.premium)} (담보 ${Number(c.rowCount) || 0}개)`)
    }
  }

  return lines.join('\n')
}

function parseJson(text: string): { headline?: unknown; points?: unknown } | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
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
    const caller = su && sk
      ? createClient(su, sk, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
      : null
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
  if (!userText) return json({ success: false, error: '설명할 담보가 없습니다.' }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('COVERAGE_MIX_MODEL') || 'claude-sonnet-5',
        max_tokens: 900,
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
    if (!parsed) return json({ success: false, error: '설명 형식 오류 — 다시 시도해 주세요.' }, 502)
    const points = (Array.isArray(parsed.points) ? parsed.points : [])
      .map((p) => clip(p, 200))
      .filter(Boolean)
      .slice(0, POINT_COUNT)
    if (points.length === 0) return json({ success: false, error: '설명을 만들지 못했습니다.' }, 502)
    return json({ success: true, result: { headline: clip(parsed.headline, 150), points } })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json(
      { success: false, error: aborted ? '설명 시간이 초과되었습니다. 다시 시도해 주세요.' : '설명 중 오류가 발생했습니다.' },
      aborted ? 504 : 502
    )
  } finally {
    clearTimeout(timer)
  }
})
