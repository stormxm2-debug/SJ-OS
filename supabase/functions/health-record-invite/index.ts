// SJ INVEST — 건강기록 '고객 입력' 링크 발급 (health-record-invite)
//
// 직원(로그인)만 호출. 고객에게 보낼 일회용 링크를 만든다:
//  1) health_record_requests 에 status='awaiting_customer' row 생성(주민번호는 저장 안 함 —
//     request_meta 에 RRN 제외 CODEF 파라미터 템플릿만 저장).
//  2) 랜덤 토큰 생성 → 해시만 row 에 저장(link_token_hash), 30분 TTL.
//  3) 솔라피 설정이 있으면 문자(LMS)로 링크 발송, 없으면 링크만 돌려줘 복사/카톡 공유.
//
// 보안: 호출자 JWT 검증, 쓰기는 service_role 로. 같은 번호 10분 내 재발급 차단.
// 주민번호·토큰 원문은 로그에 남기지 않는다.
// Secrets: SUPABASE_URL/ANON/SERVICE_ROLE 자동. 문자용 SOLAPI_API_KEY/SECRET/SENDER_PHONE(선택).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
const digits = (s: string): string => (s ?? '').replace(/\D/g, '')

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomToken(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString()
  const salt = crypto.randomUUID().replaceAll('-', '')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt))
  const signature = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}
async function sendLms(from: string, to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  if (!apiKey || !apiSecret || !from) return { ok: false, error: 'SMS_NOT_CONFIGURED' }
  const auth = await solapiAuthHeader(apiKey, apiSecret)
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ message: { to, from, type: 'LMS', subject: '건강보험 조회 안내', text } })
  })
  const data = (await res.json().catch(() => ({}))) as { errorMessage?: string; message?: string }
  if (!res.ok) return { ok: false, error: data.errorMessage || data.message || `문자 발송 실패 (HTTP ${res.status})` }
  return { ok: true }
}

function sanitizeOrigin(o: string): string {
  const s = (o ?? '').trim()
  return /^https?:\/\/[A-Za-z0-9.\-:]+$/.test(s) ? s.replace(/\/$/, '') : ''
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST 요청만 지원합니다.' }, 405)

  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!su || !anonKey || !serviceKey) return json({ ok: false, error: '서버 설정 오류.' }, 500)

  // 호출자(직원) 검증
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = createClient(su, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const uid = (await caller.auth.getUser()).data?.user?.id
  if (!uid) return json({ ok: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  let body: {
    customerId?: string | null
    customerName?: string
    phone?: string
    product?: string
    paramTemplate?: Record<string, unknown>
    encryptFields?: string[]
    idField?: string
    idLen?: number
    appOrigin?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const customerName = String(body.customerName ?? '').trim()
  const phone = digits(String(body.phone ?? ''))
  const product = String(body.product ?? '')
  const template = body.paramTemplate && typeof body.paramTemplate === 'object' ? body.paramTemplate : null
  const origin = sanitizeOrigin(String(body.appOrigin ?? ''))
  if (!customerName) return json({ ok: false, error: '고객 성함을 입력해주세요.' }, 400)
  if (phone.length < 10) return json({ ok: false, error: '고객 휴대폰 번호를 확인해주세요.' }, 400)
  if (!template) return json({ ok: false, error: '조회 설정이 올바르지 않습니다.' }, 400)
  if (!origin) return json({ ok: false, error: '링크 주소를 만들 수 없습니다.' }, 400)

  const admin = createClient(su, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 같은 번호 10분 내 대기중 링크 재발급 차단(문자 남용 방지)
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: dup } = await admin
    .from('health_record_requests')
    .select('id')
    .eq('link_sent_to', phone)
    .eq('status', 'awaiting_customer')
    .gte('created_at', since)
    .limit(1)
  if (dup && dup.length) return json({ ok: false, error: '방금 보낸 링크가 있습니다. 잠시 후 다시 시도해주세요.' }, 429)

  // 요청 row 생성(주민번호 없음 — 템플릿만)
  const meta = { paramTemplate: template, encryptFields: body.encryptFields ?? [], idField: body.idField ?? 'rrn', idLen: body.idLen ?? 13 }
  const ins = await admin
    .from('health_record_requests')
    .insert({
      staff_id: uid,
      customer_id: body.customerId ?? null,
      customer_name: customerName,
      provider: 'codef',
      product,
      status: 'awaiting_customer',
      request_meta: meta,
      link_sent_to: phone,
      link_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })
    .select('id')
    .single()
  const id = (ins.data as { id?: string } | null)?.id
  if (ins.error || !id) return json({ ok: false, error: '요청을 생성하지 못했습니다.' }, 500)

  const token = randomToken()
  const upd = await admin.from('health_record_requests').update({ link_token_hash: await sha256Hex(`${id}:${token}`) }).eq('id', id)
  if (upd.error) return json({ ok: false, error: '링크 토큰 저장에 실패했습니다.' }, 500)

  const url = `${origin}/?hr=1&r=${id}&t=${token}`

  // 문자 발송(설정 있을 때만)
  const from = digits(Deno.env.get('SOLAPI_SENDER_PHONE') ?? '')
  const smsText = `[SJ INVEST] ${customerName}님, 건강보험 조회를 위해 아래 링크에서 본인확인(주민번호+간편인증)을 진행해 주세요.\n${url}\n(30분 이내 1회용 링크)`
  let smsSent = false
  let smsError: string | undefined
  if (from) {
    const r = await sendLms(from, phone, smsText)
    smsSent = r.ok
    if (!r.ok) smsError = r.error === 'SMS_NOT_CONFIGURED' ? undefined : r.error
  }

  return json({ ok: true, requestId: id, url, smsSent, smsError })
})
