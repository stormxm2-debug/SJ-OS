// SJ INVEST — AI 보장분석 (insurance-analysis, Claude 기반)
//
// 단일 모드 analyze: 고객 증권(사진/PDF) + 선택 프로필 → 보장 갭 분석.
//  - 증권의 모든 담보를 읽어 카테고리별 현재 보장현황·적정성 판정
//  - 보장 공백(부족/미가입) + 왜 필요한지 + 보완 제안(영업 기회)
//  - 종합 제안 + 고객 안내문
// 청구비서(보험금 계산)와 목적이 다르다 — 이건 "뭐가 부족하고 뭘 제안할까"(영업용).
// 키는 ANTHROPIC_API_KEY 시크릿. 증권·프로필은 메모리에서만 처리되고 저장되지 않는다.

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
  const raw = text.slice(start)
  try {
    return JSON.parse(autoClose(raw)) as Record<string, unknown>
  } catch {
    /* try harder */
  }
  let cut = raw.lastIndexOf('}')
  for (let i = 0; i < 20 && cut > 0; i += 1) {
    try {
      return JSON.parse(autoClose(raw.slice(0, cut + 1))) as Record<string, unknown>
    } catch {
      cut = raw.lastIndexOf('}', cut - 1)
    }
  }
  return null
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callClaude(apiKey: string, system: string, content: any[], maxTokens: number): Promise<{ ok: boolean; text?: string; error?: string; truncated?: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 135000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        // 증권 판독+분석은 고속 모델로 충분(청구비서 extract도 sonnet). env로 교체 가능.
        model: Deno.env.get('INSURANCE_ANALYSIS_MODEL') || 'claude-sonnet-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content }]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || `Claude 오류 (HTTP ${r.status})`
      return { ok: false, error: msg }
    }
    const blocks = (data as { content?: { type: string; text?: string }[] }).content ?? []
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    const truncated = (data as { stop_reason?: string }).stop_reason === 'max_tokens'
    return { ok: true, text, truncated }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '분석 시간이 초과되었습니다. 증권 수를 줄여 다시 시도해 주세요.' : '분석 중 오류가 발생했습니다.' }
  } finally {
    clearTimeout(timer)
  }
}

const ANALYZE_SYSTEM = [
  '당신은 대한민국 최고의 보험 보장분석 전문가(설계 실무 20년)이며, FC(설계사)가 고객에게 보장을 제안하도록 돕습니다.',
  '첨부된 고객의 보험 증권(들)을 정밀 판독해 현재 보장을 파악하고, 부족한 보장(공백)과 보완 제안을 아래 JSON으로만 답하세요.',
  '응답의 첫 글자는 반드시 { 여야 합니다 — 인사말·설명·마크다운 코드펜스(```) 절대 금지.',
  '고객이 자신의 보장 점검을 위해 제출한 서류이며, 당신은 판독을 허가받았습니다. 판독을 거부하지 마세요.',
  '',
  '{"summary":"고객 보장 현황 한 줄 요약 (예: 실손·암은 있으나 뇌·심장·후유장해가 비어 있음)",',
  '"policies":[{"insurer":"보험사명","product":"상품명(보이면)","monthlyPremium":"월납 보험료 숫자(원, 보이면) 또는 null"}],',
  '"categories":[{"category":"사망|진단비|입원|수술|실손|후유장해|배상책임|소득보장|연금|저축","current":"현재 가입 요약 (예: 암진단비 3천만·뇌졸중 2천만)","adequacy":"sufficient|partial|insufficient|none","note":"판단 근거 1문장(60자 이내)"}],',
  '"gaps":[{"title":"보장 공백 제목 (예: 뇌혈관 진단비 미가입)","severity":"high|medium|low","why":"왜 필요한지 — 리스크·통계 근거 1문장","suggestion":"보완 제안 (담보·대략 가입금액 방향)"}],',
  '"recommendation":"FC가 고객에게 제안할 종합 방향 2~3문장 (우선순위 순).",',
  '"customerMessage":"고객에게 카톡으로 보낼 존댓말 안내문 3~5문장 — 현재 보장 요약, 핵심 공백, 다음 상담 제안. 확정적 단정·불안 조성 금지.",',
  '"cautions":["FC 주의사항 (각 70자 이내)"]}',
  '',
  '규칙:',
  '1) 증권에 실제로 적힌 담보·금액만 근거로 현재 보장을 판단. 없는 정보는 지어내지 말 것. 판독이 어려운 담보는 note에 "증권 확인 필요"로.',
  '2) categories는 위 10개 카테고리를 모두 다루되, 해당 담보가 전혀 없으면 adequacy=none, current="미가입"으로 명시(공백을 숨기지 말 것).',
  '3) 적정성 판정은 일반적 권장 수준 대비 상대적으로 (예: 암진단비 3천만은 partial, 실손 있음은 대체로 sufficient). 나이·성별·직업 프로필이 주어지면 반영.',
  '4) gaps는 severity 높은 순으로 최대 6개. 실제 리스크가 큰 공백(뇌·심장·후유장해·간병 등) 우선.',
  '5) 불안을 부추기지 말고 사실 기반으로. 상품 추천은 담보 종류·방향까지만(특정 상품명 강매 금지).',
  '6) 간결하게(응답이 잘리지 않도록): note 60자, gaps.why/suggestion 각 80자 이내. 모두 한국어.'
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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ success: false, code: 'ANTHROPIC_API_KEY_MISSING', error: 'ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.' }, 503)
  }

  let body: { mode?: unknown; files?: unknown; profile?: Record<string, unknown>; extraNotes?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  if (String(body.mode ?? '') !== 'analyze') {
    return json({ success: false, error: '알 수 없는 mode 입니다 (analyze).' }, 400)
  }

  const rawFiles = Array.isArray(body.files) ? (body.files as Record<string, unknown>[]) : []
  if (rawFiles.length === 0) return json({ success: false, error: '분석할 증권을 먼저 올려주세요.' }, 400)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  const p = body.profile ?? {}
  const profileLine = [
    p.age ? `나이 만 ${p.age}세` : '',
    p.gender ? `성별 ${p.gender}` : '',
    p.job ? `직업 ${p.job}` : '',
    p.medicalHistory ? `병력 ${String(p.medicalHistory).slice(0, 300)}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  content.push({ type: 'text', text: profileLine ? `고객 프로필: ${profileLine}` : '고객 프로필: 미제공' })

  let idx = 0
  for (const f of rawFiles.slice(0, 6)) {
    idx += 1
    const name = String(f.name ?? `증권${idx}`).slice(0, 120)
    const data = typeof f.data === 'string' ? f.data : ''
    if (!data) return json({ success: false, error: `"${name}" 파일이 비어 있습니다. 원본을 다시 올려주세요.` }, 400)
    const mime = String(f.mediaType ?? 'image/jpeg')
    if (mime !== 'application/pdf' && !ALLOWED_IMAGE_TYPES.has(mime)) {
      return json({ success: false, error: `"${name}" 형식(${mime})은 지원되지 않습니다. JPG/PNG 사진이나 PDF로 올려주세요.` }, 400)
    }
    content.push({ type: 'text', text: `[증권 ${idx}] 파일명: ${name}` })
    if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
    }
  }
  const extra = String(body.extraNotes ?? '').trim()
  content.push({ type: 'text', text: `위 ${idx}개 증권을 판독해 현재 보장을 분석하고, 보장 공백과 보완 제안을 JSON으로 작성하세요.${extra ? ` (설계사 메모: ${extra.slice(0, 500)})` : ''}` })

  const res = await callClaude(apiKey, ANALYZE_SYSTEM, content, 10000)
  if (!res.ok) return json({ success: false, error: res.error }, 502)
  const parsed = parseJson(res.text ?? '')
  if (!parsed || !Array.isArray(parsed.categories)) {
    return json({ success: false, error: '보장분석 결과 형식 오류 — 다시 시도해 주세요.' }, 502)
  }
  return json({ success: true, mode: 'analyze', result: parsed, truncated: Boolean(res.truncated) })
})
