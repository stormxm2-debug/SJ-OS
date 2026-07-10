// SJ INVEST — AI 사전심사 언더라이터 (underwriting-expert, Claude 기반)
//
// 단일 모드 assess: 고객 프로필 + 계약전 알릴의무(고지) 문답 → 예상 인수 결과.
//  - 예상 등급(무난/대체로 가능/조건부/어려움/정보부족) + 상품군별 예상 조건
//  - 핵심 심사 포인트, 정확 고지 가이드, 유병자·간편심사 대안, 고객 안내문
// 절대 규칙: 고지 축소·은폐 유도 금지(정확 고지 전제), 단정 금지(최종 인수는 보험사).
// 키는 ANTHROPIC_API_KEY 시크릿. 병력 등 입력은 메모리에서만 처리되고 로깅·저장되지 않는다.

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

/**
 * Claude 응답에서 JSON 파싱. max_tokens로 잘린 응답도 최대한 복구:
 * ① 그대로 → ② 괄호 자동 닫기 → ③ 마지막 완전한 '}'까지 자르고 자동 닫기.
 */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callClaude(apiKey: string, system: string, content: any[], maxTokens: number): Promise<{ ok: boolean; text?: string; error?: string; truncated?: boolean }> {
  const controller = new AbortController()
  // Supabase 요청 타임아웃(150s)보다 먼저 끊어 친절한 오류가 나가게 한다.
  const timer = setTimeout(() => controller.abort(), 135000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: Deno.env.get('UNDERWRITING_MODEL') || Deno.env.get('CLAIM_EXPERT_MODEL') || 'claude-opus-4-8',
        max_tokens: maxTokens,
        system,
        // 주의: opus-4-8은 assistant 프리필 미지원 — JSON 시작 강제는 시스템 프롬프트 + parseJson 복구로 대신.
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
    return { ok: false, error: aborted ? '심사 분석 시간이 초과되었습니다. 다시 시도해 주세요.' : '심사 분석 중 오류가 발생했습니다.' }
  } finally {
    clearTimeout(timer)
  }
}

const ASSESS_SYSTEM = [
  '당신은 대한민국 생명·손해보험 인수심사(언더라이팅) 실무 30년의 최고 전문가입니다. 보험설계사가 청약 전에 참고할 "사전심사 예측 리포트"를 작성합니다.',
  '아래 JSON으로만 답하세요. 응답의 첫 글자는 반드시 { 여야 합니다 — 인사말·설명·마크다운 코드펜스(```) 절대 금지.',
  '',
  '판단 기준 (대한민국 보험 실무):',
  '- 표준 계약전 알릴의무 구조: ①3개월 내 진찰·검사 소견/투약 ②1년 내 추가검사(재검사) ③5년 내 입원·수술·7일 이상 치료·30일 이상 투약 ④5년 내 중대질병(암·백혈병·고혈압·당뇨·심근경색·협심증·간경화·뇌졸중 등) 진단·치료.',
  '- 국내 생·손보 일반 인수 관행: 부담보(1~5년), 할증(보험료 증액), 조건부 인수, 거절 기준. 치료 종결 후 경과 기간이 길수록 유리.',
  '- BMI(저체중/고도비만), 흡연, 음주, 직업 위험등급(상해 급수)도 반영.',
  '- 보험사·상품·시점마다 기준이 다르므로 "일반적 경향"으로 판단하고, 보험사별 차이가 큰 항목은 그 사실을 명시.',
  '',
  '절대 규칙:',
  '1) 고지 축소·은폐·누락을 권하는 표현 절대 금지. 모든 판단은 정확한 고지를 전제로 한다. disclosureGuide는 "정확하면서 유리하게" 고지하는 방법만 담는다 (예: 치료 종결 시점 명확화, 완치 확인 서류 준비, 정확한 병명·시기 확인).',
  '2) 단정 금지 — 최종 인수 여부는 보험사 심사로 결정된다. "예상/가능성" 관점으로만 서술.',
  '3) 입력에 없는 사실을 지어내지 말 것. 정보가 부족해 판단이 어려우면 해당 상품군 verdict를 "정보필요"로 하고 neededInfo에 구체적으로 적을 것.',
  '4) 조건이 좋지 않을 때는 유병자·간편심사(3·5·5, 3·2·5, 무심사 등) 대안을 반드시 alternatives에 제시. 조건이 좋으면 alternatives는 빈 배열.',
  '5) 요청된 모든 관심 상품군을 byArea에 하나도 빠짐없이 포함 (누락 금지).',
  '6) "사내 인수기준 분류표" 데이터가 입력되면 그 질병·보험사 조합에 한해 일반 관행보다 최우선 근거로 사용할 것 ([검수완료] 항목이 가장 신뢰도 높음, [참고용]은 보조). 보험사별 차이가 확인되면 summary나 cautions에 유리한 보험사 방향을 언급.',
  '',
  '{"overallGrade":"standard|likely|conditional|difficult|info-needed",',
  '"headline":"한 줄 결론 (30자 이내, 예: 갑상선 부담보 조건이면 대부분 가입 가능)",',
  '"summary":"종합 소견 2~4문장 — 핵심 리스크와 전체 전망",',
  '"byArea":[{"area":"요청된 상품군명 그대로","verdict":"가능|조건부|어려움|정보필요","condition":"예상 조건 (예: 갑상선 부담보 3~5년, 할증 20~30% 가능성, 없으면 null)","reason":"판단 근거 1문장 (60자 이내)"}],',
  '"keyFactors":[{"factor":"심사에 영향을 주는 요인","impact":"high|medium|low","note":"영향 설명 (50자 이내)"}],',
  '"disclosureGuide":["정확하고 유리한 고지 방법 안내 (각 70자 이내)"],',
  '"alternatives":[{"name":"대안 (예: 간편심사 3·5·5 건강보험)","why":"이 고객에게 맞는 이유","note":"주의점 (보험료 할증 수준 등)"}],',
  '"neededInfo":["판단 정확도를 높이기 위해 추가 확인이 필요한 정보"],',
  '"customerMessage":"고객에게 카톡으로 보낼 존댓말 안내문 3~5문장 — 예상 방향, 필요한 준비(서류·검사결과), 다음 단계. 확정처럼 말하지 말 것.",',
  '"cautions":["설계사가 주의할 점 (각 70자 이내)"]}',
  '',
  '등급 기준: standard=표준체로 무난히 가능 / likely=대체로 가능(경미한 조건 가능성) / conditional=부담보·할증 등 조건부 가능성 높음 / difficult=거절 가능성 높음(대안 필수) / info-needed=정보 부족.',
  '간결하게 (응답이 잘리지 않도록): summary 4문장 이내, byArea.reason 60자 이내, keyFactors 최대 6개, disclosureGuide·cautions 각 최대 5개. 모두 한국어.'
].join('\n')

interface Disclosure {
  has: boolean
  detail: string
}

function disclosureLine(label: string, d: Disclosure | undefined): string {
  if (!d) return `${label}: 응답 없음`
  if (!d.has) return `${label}: 아니오`
  return `${label}: 예 — ${d.detail ? d.detail.slice(0, 1000) : '(세부 내용 미입력)'}`
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

  let body: {
    mode?: unknown
    profile?: Record<string, unknown>
    disclosures?: Record<string, Disclosure>
    medicalHistory?: unknown
    targetAreas?: unknown
    extraNotes?: unknown
    knownRules?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  if (String(body.mode ?? '') !== 'assess') {
    return json({ success: false, error: '알 수 없는 mode 입니다 (assess).' }, 400)
  }

  const p = body.profile ?? {}
  const areas = Array.isArray(body.targetAreas) ? body.targetAreas.map(String).slice(0, 10) : []
  if (areas.length === 0) return json({ success: false, error: '심사할 상품군을 1개 이상 선택해 주세요.' }, 400)
  const age = Number(p.age ?? 0)
  if (!age || age < 0 || age > 120) return json({ success: false, error: '고객 나이를 확인해 주세요.' }, 400)

  // 사내 인수기준 분류표(예외질병 인수 가이드) — 고객 병력과 매칭된 항목만 전달됨.
  const rules = (Array.isArray(body.knownRules) ? body.knownRules : []).slice(0, 60).map((r) => {
    const o = r as Record<string, unknown>
    const note = String(o.note ?? '').slice(0, 200)
    return `- ${String(o.disease ?? '').slice(0, 60)} | ${String(o.insurer ?? '').slice(0, 30)}: ${String(o.status ?? '').slice(0, 20)}${note ? ` (${note})` : ''} [${o.verified ? '검수완료' : '참고용'}]`
  })

  const d = body.disclosures ?? {}
  const lines = [
    '--- 고객 프로필 ---',
    `나이: 만 ${age}세 / 성별: ${String(p.gender ?? '미상')}`,
    p.heightCm && p.weightKg ? `키/몸무게: ${p.heightCm}cm / ${p.weightKg}kg (BMI ${p.bmi ?? '계산 불가'})` : '키/몸무게: 미입력',
    `직업: ${String(p.job ?? '') || '미입력'}`,
    `흡연: ${String(p.smoking ?? '') || '미입력'} / 음주: ${String(p.drinking ?? '') || '미입력'}`,
    '',
    '--- 계약전 알릴의무(고지) 문답 ---',
    disclosureLine('① 3개월 내 진찰·검사 소견 또는 투약', d.m3),
    disclosureLine('② 1년 내 추가검사(재검사)', d.y1),
    disclosureLine('③ 5년 내 입원·수술·7일 이상 치료·30일 이상 투약', d.y5),
    disclosureLine('④ 5년 내 중대질병 진단·치료', d.major),
    '',
    `--- 병력 메모 (고객 DB) ---`,
    String(body.medicalHistory ?? '').slice(0, 2000) || '없음',
    '',
    `--- 심사 요청 상품군 ---`,
    areas.join(', '),
    rules.length > 0 ? `\n--- 사내 인수기준 분류표 (질병×보험사 — 매칭 항목) ---\n${rules.join('\n')}` : '',
    String(body.extraNotes ?? '').trim() ? `\n--- 설계사 추가 메모 ---\n${String(body.extraNotes).slice(0, 1000)}` : ''
  ]

  const res = await callClaude(apiKey, ASSESS_SYSTEM, [{ type: 'text', text: lines.filter((l) => l !== '').join('\n') }], 10000)
  if (!res.ok) return json({ success: false, error: res.error }, 502)
  const parsed = parseJson(res.text ?? '')
  if (!parsed || !Array.isArray(parsed.byArea) || !parsed.overallGrade) {
    return json({ success: false, error: '심사 결과 형식 오류 — 다시 시도해 주세요.' }, 502)
  }
  return json({ success: true, mode: 'assess', result: parsed, truncated: Boolean(res.truncated) })
})
