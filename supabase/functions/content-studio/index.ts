// SJ INVEST — AI 콘텐츠 스튜디오 (content-studio)
//
// 입력: { kind: 'reels' | 'sns' | 'blog' | 'notice', topic: string, target?: string, tone?: string }
// 출력: { success, content: { title, sections: [{label, text}], hashtags: string[] } }
//
// FC의 보험 마케팅 콘텐츠 초안(릴스 대본·SNS 문구·블로그·고객 안내문)을 생성한다.
// 키는 ANTHROPIC_API_KEY 시크릿(기존 claim-expert와 공유), 모델은 CONTENT_STUDIO_MODEL
// 오버라이드 가능(기본 claude-sonnet-5). 로그인한 직원만 호출 가능 (보안 H1 정책).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

type Kind = 'reels' | 'sns' | 'blog' | 'notice'

const KIND_SPEC: Record<Kind, string> = {
  reels: [
    '유형: 인스타그램/유튜브 숏폼(릴스) 대본 — 30~45초 분량.',
    'sections 구성(순서 고정): "훅 (0~3초)" 1개 → "장면 N" 3~5개 → "CTA (마무리)" 1개.',
    '각 장면 text는 "화면: (연출·자막 지시) / 내레이션: (말할 대사)" 두 줄 형식.',
    '훅은 스크롤을 멈추게 하는 한 문장, CTA는 프로필 링크·DM 유도.'
  ].join('\n'),
  sns: [
    '유형: 인스타그램 피드/스토리 문구.',
    'sections 구성: "본문" 1개(3~6문장, 줄바꿈 포함, 이모지 소량) → "짧은 버전" 1개(스토리용 1~2문장).'
  ].join('\n'),
  blog: [
    '유형: 블로그 초안.',
    'sections 구성: "도입" → "본문 소제목" 2~3개(각 2~4문단) → "마무리". 각 label은 실제 소제목 문구로.'
  ].join('\n'),
  notice: [
    '유형: 기존 고객에게 보내는 정중한 안내문(카톡/문자용).',
    'sections 구성: "안내문" 1개(존댓말, 6~10문장, 인사→핵심 안내→행동 안내→맺음). hashtags는 빈 배열.'
  ].join('\n')
}

const SYSTEM_PROMPT = [
  '당신은 대한민국 보험 영업(GA·삼성화재 계열) 전문 콘텐츠 마케터입니다.',
  '설계사(FC)가 쓸 콘텐츠 초안을 아래 JSON 형식으로만 답하세요 (다른 텍스트·마크다운 금지):',
  '{"title":"콘텐츠 제목 한 줄","sections":[{"label":"구간 이름","text":"내용"}],"hashtags":["#태그",...]}',
  '',
  '공통 규칙:',
  '1) 보험업법·광고심의 기준 준수: 확정 수익/보장 과장/타사 비방/"최고·유일" 표현 금지. 구체적 보험료·환급률 수치 지어내기 금지.',
  '2) 특정 상품명 언급 대신 담보·보장 개념 중심으로. 사실 단정 대신 "~일 수 있습니다" 화법.',
  '3) 전 국민 눈높이의 쉬운 한국어. 전문용어는 한 줄 풀이를 붙인다.',
  '4) hashtags는 한국어 위주 5~8개 (notice 유형은 빈 배열).',
  '5) 요청한 타깃·톤이 있으면 반드시 반영.'
].join('\n')

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // (보안 H1) 호출자 인증 — 로그인한 직원만 (anon 키 단독 호출 차단).
  {
    const su = Deno.env.get('SUPABASE_URL') ?? ''
    const sk = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const caller = su && sk ? createClient(su, sk, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } }) : null
    const uid = caller ? (await caller.auth.getUser()).data?.user?.id : null
    if (!uid) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ success: false, code: 'ANTHROPIC_API_KEY_MISSING', error: 'ANTHROPIC_API_KEY 시크릿이 없습니다.' }, 503)

  let body: { kind?: unknown; topic?: unknown; target?: unknown; tone?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const kind = String(body.kind ?? '') as Kind
  const topic = String(body.topic ?? '').trim()
  if (!KIND_SPEC[kind]) return json({ success: false, error: '콘텐츠 유형이 올바르지 않습니다.' }, 400)
  if (!topic) return json({ success: false, error: '주제를 입력해주세요.' }, 400)

  const user = [
    KIND_SPEC[kind],
    '',
    `주제: ${topic.slice(0, 300)}`,
    body.target ? `타깃: ${String(body.target).slice(0, 50)}` : '',
    body.tone ? `톤: ${String(body.tone).slice(0, 30)}` : ''
  ]
    .filter(Boolean)
    .join('\n')

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
        model: Deno.env.get('CONTENT_STUDIO_MODEL') || 'claude-sonnet-5',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return json({ success: false, error: data?.error?.message || `AI 오류 (HTTP ${r.status}).` }, 502)

    const raw = String(data?.content?.[0]?.text ?? '')
    // 모델이 코드펜스로 감싸는 경우 방어
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    let parsed: { title?: unknown; sections?: unknown; hashtags?: unknown } = {}
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return json({ success: false, error: '생성 결과 형식 오류 — 다시 시도해 주세요.' }, 502)
    }
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((s) => ({
            label: String((s as { label?: unknown })?.label ?? '').slice(0, 60),
            text: String((s as { text?: unknown })?.text ?? '').slice(0, 4000)
          }))
          .filter((s) => s.label && s.text)
          .slice(0, 12)
      : []
    if (sections.length === 0) return json({ success: false, error: '생성 결과가 비었습니다 — 다시 시도해 주세요.' }, 502)
    return json({
      success: true,
      content: {
        title: String(parsed.title ?? '').slice(0, 120) || topic.slice(0, 60),
        sections,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map((h) => String(h).slice(0, 30)).filter(Boolean).slice(0, 10) : []
      }
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '생성 시간 초과 — 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' }, 502)
  } finally {
    clearTimeout(timer)
  }
})
