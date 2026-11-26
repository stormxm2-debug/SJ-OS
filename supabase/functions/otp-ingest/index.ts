// SJ INVEST — OTP 수신 엔드포인트 (otp-ingest)
//
// 폰(안드로이드) 포워더 앱이 보험사 인증문자에서 추출한 코드를 여기로 POST 한다.
// 인증: 로그인 JWT 대신 '기기 토큰'(otp_devices.token). verify_jwt=false 로 배포.
//
// 입력: { token: string, code: string, insurer?: string, sender?: string, raw?: string }
// 출력: { ok: true } | { ok: false, error }
//
// 서버 쓰기는 service_role 로 수행(RLS 우회). 토큰이 유효한 활성 기기여야 저장된다.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceKey) return json({ ok: false, error: 'server not configured' }, 503)

  let body: { token?: unknown; code?: unknown; insurer?: unknown; sender?: unknown; raw?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'bad request' }, 400)
  }

  // 토큰: 바디 또는 헤더(x-device-token) 허용
  const token = String(body.token ?? req.headers.get('x-device-token') ?? '').trim()
  const code = String(body.code ?? '').replace(/\s+/g, '').trim()
  if (!token) return json({ ok: false, error: 'missing token' }, 401)
  if (!code || code.length < 3 || code.length > 12) return json({ ok: false, error: 'invalid code' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 기기 토큰 → FC 식별
  const { data: device } = await admin
    .from('otp_devices')
    .select('id, staff_id, active')
    .eq('token', token)
    .maybeSingle()
  if (!device || !(device as { active?: boolean }).active) return json({ ok: false, error: 'unknown device' }, 403)

  const staffId = (device as { staff_id: string }).staff_id

  const insurer = body.insurer != null ? String(body.insurer).slice(0, 40) : null
  const sender = body.sender != null ? String(body.sender).slice(0, 40) : null
  const raw = body.raw != null ? String(body.raw).slice(0, 500) : null

  const { error } = await admin.from('otp_codes').insert({
    staff_id: staffId,
    code: code.slice(0, 12),
    insurer,
    sender,
    raw
  })
  if (error) return json({ ok: false, error: 'save failed' }, 502)

  await admin.from('otp_devices').update({ last_used_at: new Date().toISOString() }).eq('id', (device as { id: string }).id)

  return json({ ok: true })
})
