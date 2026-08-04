// SJ INVEST — 자료 브리핑 AI 정리 (knowledge-digest)
// 카톡·카페에서 받은 사내 자료(텍스트/이미지/PDF)를 분류·요약·핵심 포인트·태그로 정리.
// 입력: { titleHint?, bodyText?, fileBase64?, fileMime?, sourceHint? }
// 출력: { success, digest: { title, category, summary, keyPoints[], tags[], actionForFc } }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const CATEGORIES = ['시책', '상품개정', '인수지침', '교육', '공지', '기타']

const SYSTEM_PROMPT = [
  '당신은 대한민국 보험 GA(법인대리점) 사내 자료 정리 전문가입니다.',
  '카카오톡 방·네이버 카페에서 공유된 자료(시책 안내, 상품 개정, 인수지침 변경, 교육자료, 공지)를 받아',
  '설계사(FC)들이 한눈에 볼 수 있게 정리합니다. 아래 JSON 형식으로만 답하세요 (다른 텍스트 금지):',
  `{"title":"자료 제목 (25자 내, 보험사명·상품명이 있으면 포함)","category":"${CATEGORIES.join(' | ')} 중 하나","summary":"핵심 요약 3~4문장","keyPoints":["FC가 꼭 알아야 할 포인트 3~7개 — 숫자·날짜·조건은 정확히"],"tags":["검색용 태그 2~6개 — 보험사명·상품군·키워드"],"actionForFc":"FC가 당장 할 일 1문장 (없으면 빈 문자열)"}`,
  '',
  '규칙:',
  '1) 숫자·날짜·퍼센트·한도는 원문 그대로 정확히 옮긴다 — 임의로 바꾸지 않는다.',
  '2) 흐릿하거나 잘려서 확실하지 않은 내용은 keyPoints에 "(원본 확인 필요)"를 붙인다.',
  '3) 자료가 보험·영업과 무관하면 category는 "기타", summary에 그 사실을 명시한다.',
  '모두 한국어.'
].join('\n')

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // (보안 H1) 호출자 인증 — 로그인한 직원만 (AI 무단 사용·요금 남용 차단).
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

  let body: { titleHint?: unknown; bodyText?: unknown; fileBase64?: unknown; fileMime?: unknown; sourceHint?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const titleHint = String(body.titleHint ?? '').trim()
  const bodyText = String(body.bodyText ?? '').trim()
  const fileBase64 = String(body.fileBase64 ?? '')
  const fileMime = String(body.fileMime ?? '')
  const sourceHint = String(body.sourceHint ?? '').trim()
  if (!bodyText && !fileBase64) return json({ success: false, error: '분석할 텍스트나 파일이 필요합니다.' }, 400)

  // 사용자 콘텐츠 블록 구성 — 이미지/PDF는 비전 판독
  const content: unknown[] = []
  if (fileBase64 && fileMime.startsWith('image/')) {
    content.push({ type: 'image', source: { type: 'base64', media_type: fileMime, data: fileBase64 } })
  } else if (fileBase64 && fileMime === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } })
  }
  const textParts = [
    sourceHint ? `[출처] ${sourceHint}` : '',
    titleHint ? `[제목 힌트] ${titleHint}` : '',
    bodyText ? `[자료 원문]\n${bodyText.slice(0, 12000)}` : '위 자료(이미지/문서)를 판독해 정리해 주세요.'
  ].filter(Boolean)
  content.push({ type: 'text', text: textParts.join('\n\n') })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('KNOWLEDGE_DIGEST_MODEL') || 'claude-sonnet-5',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return json({ success: false, error: data?.error?.message || `Anthropic 오류 (HTTP ${r.status}).` }, 502)
    const raw = String(data?.content?.[0]?.text ?? '')
    const m = raw.match(/\{[\s\S]*\}/)
    let d: Record<string, unknown> = {}
    try {
      d = JSON.parse(m ? m[0] : raw)
    } catch {
      return json({ success: false, error: '정리 결과 형식 오류.' }, 502)
    }
    const category = String(d.category ?? '기타')
    return json({
      success: true,
      digest: {
        title: String(d.title ?? titleHint ?? '자료').slice(0, 60),
        category: CATEGORIES.includes(category) ? category : '기타',
        summary: String(d.summary ?? '').slice(0, 1000),
        keyPoints: Array.isArray(d.keyPoints) ? d.keyPoints.map((p) => String(p).slice(0, 300)).slice(0, 8) : [],
        tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).slice(0, 24)).slice(0, 6) : [],
        actionForFc: String(d.actionForFc ?? '').slice(0, 300)
      }
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ success: false, error: aborted ? '분석 시간 초과. 다시 시도해 주세요.' : '분석 중 오류가 발생했습니다.' }, aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
})
