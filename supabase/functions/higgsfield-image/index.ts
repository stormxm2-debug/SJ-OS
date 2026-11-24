// SJ INVEST — AI 이미지 생성 (higgsfield-image)
//
// 입력: { prompt: string, aspect_ratio?: string, resolution?: '1k' | '2k' }
// 출력: { success, imageUrl } | { success: false, error, code? }
//
// 힉스필드 Z-Image Turbo(text-to-image)로 마케팅/안내용 이미지를 생성한다.
// 키는 HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_KEY_SECRET 시크릿(콘솔에서 발급).
// 인증: Authorization: Key <id>:<secret>. 로그인한 직원만 호출 가능 (보안 H1 정책).
//
// 흐름: POST /z-image/turbo → { request_id, status_url } → status_url 폴링 → completed 시 images[0].url.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const HF_BASE = 'https://api.higgsfield.ai'

const ALLOWED_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '7:9', '9:7', '9:16', '16:9', '21:9'])

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

  const keyId = Deno.env.get('HIGGSFIELD_API_KEY_ID')
  const keySecret = Deno.env.get('HIGGSFIELD_API_KEY_SECRET')
  if (!keyId || !keySecret) {
    return json({ success: false, code: 'HIGGSFIELD_KEY_MISSING', error: 'HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET 시크릿이 없습니다.' }, 503)
  }

  let body: { prompt?: unknown; aspect_ratio?: unknown; resolution?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const prompt = String(body.prompt ?? '').trim()
  if (!prompt) return json({ success: false, error: '이미지 설명(프롬프트)을 입력해주세요.' }, 400)
  if (prompt.length > 800) return json({ success: false, error: '이미지 설명은 800자 이내로 입력해주세요.' }, 400)

  const aspect_ratio = ALLOWED_RATIOS.has(String(body.aspect_ratio)) ? String(body.aspect_ratio) : '1:1'
  const resolution = String(body.resolution) === '2k' ? '2k' : '1k'

  const authHeader = `Key ${keyId}:${keySecret}`

  // 1) 생성 요청 제출
  let submitData: { status?: string; request_id?: string; status_url?: string; detail?: string }
  try {
    const submit = await fetch(`${HF_BASE}/z-image/turbo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ prompt, resolution, aspect_ratio, prompt_extend: false })
    })
    submitData = await submit.json().catch(() => ({}))
    if (!submit.ok) {
      const msg = submitData?.detail || `이미지 생성 요청 실패 (HTTP ${submit.status}).`
      return json({ success: false, error: submit.status === 401 ? '힉스필드 인증 실패 — API 키를 확인해주세요.' : msg }, 502)
    }
  } catch {
    return json({ success: false, error: '이미지 생성 서버에 연결하지 못했습니다.' }, 502)
  }

  const statusUrl = submitData.status_url || (submitData.request_id ? `${HF_BASE}/requests/${submitData.request_id}/status` : '')
  if (!statusUrl) return json({ success: false, error: '요청 ID를 받지 못했습니다.' }, 502)

  // 2) 상태 폴링 (최대 ~50초)
  const deadline = Date.now() + 50000
  while (Date.now() < deadline) {
    await sleep(2000)
    let sd: { status?: string; images?: { url?: string }[] }
    try {
      const st = await fetch(statusUrl, { headers: { Authorization: authHeader } })
      sd = await st.json().catch(() => ({}))
    } catch {
      continue
    }
    const status = String(sd.status ?? '')
    if (status === 'completed') {
      const url = sd.images?.[0]?.url
      if (!url) return json({ success: false, error: '이미지 URL을 받지 못했습니다.' }, 502)
      return json({ success: true, imageUrl: url })
    }
    if (status === 'failed' || status === 'nsfw' || status === 'canceled') {
      return json({ success: false, error: status === 'nsfw' ? '부적절한 내용으로 생성이 거부되었습니다.' : '이미지 생성에 실패했습니다.' }, 502)
    }
  }
  return json({ success: false, code: 'TIMEOUT', error: '생성 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.' }, 504)
})
