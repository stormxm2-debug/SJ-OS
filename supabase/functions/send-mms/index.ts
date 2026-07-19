// SJ INVEST — 고객에게 사진 문자(MMS) 발송 (send-mms)
//
// POST { customerId, text, image(base64), subject? }
//   - 로그인 사용자만. 고객 전화번호는 서버가 RLS 범위에서 조회(클라가 번호를 보내지 않음).
//     → 내가 볼 수 있는 고객이 아니면 조회 0건 → 거부. (owner/admin/담당 FC만 접근)
//   - 사진은 클라이언트가 이미 ~200KB JPEG로 압축한 base64를 보내고, 서버는 그대로
//     솔라피 스토리지에 올린다(서버 인코딩 없음 — CPU 한도 회피).
//
// 솔라피 MMS — 필요한 시크릿(알림톡과 동일 계정):
//   SOLAPI_API_KEY / SOLAPI_API_SECRET
//   SOLAPI_SENDER_PHONE   발신번호(솔라피 사전등록, SMS/MMS 공용)
// 시크릿 없으면 503 MMS_NOT_CONFIGURED.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

/** MMS base64 상한(~260KB, 200KB 이미지 여유). */
const MAX_IMG_B64 = 360_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function digits(s: string): string {
  return (s ?? '').replace(/\D/g, '')
}

async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString()
  const salt = crypto.randomUUID().replaceAll('-', '')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt))
  const signature = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

/** 솔라피 스토리지에 MMS 이미지 업로드 → fileId. base64 그대로 전달. */
async function uploadImage(auth: string, name: string, base64: string): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const res = await fetch('https://api.solapi.com/storage/v1/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ file: base64, name, type: 'MMS' })
  })
  const data = (await res.json().catch(() => ({}))) as { fileId?: string; errorMessage?: string; message?: string }
  if (!res.ok || !data.fileId) return { ok: false, error: data.errorMessage || data.message || `이미지 업로드 실패 (HTTP ${res.status})` }
  return { ok: true, fileId: data.fileId }
}

async function sendMms(auth: string, from: string, to: string, text: string, imageId: string, subject?: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ message: { to, from, type: 'MMS', text, imageId, subject: subject || 'SJ INVEST' } })
  })
  const data = (await res.json().catch(() => ({}))) as { groupId?: string; messageId?: string; errorMessage?: string; message?: string }
  if (!res.ok) return { ok: false, error: data.errorMessage || data.message || `솔라피 MMS 오류 (HTTP ${res.status})` }
  return { ok: true, providerId: data.messageId ?? data.groupId }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!url || !anonKey) return json({ success: false, error: '서버 설정 오류.' }, 500)

  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  const from = digits(Deno.env.get('SOLAPI_SENDER_PHONE') ?? '')
  if (!apiKey || !apiSecret || !from) {
    return json({ success: false, code: 'MMS_NOT_CONFIGURED', error: '사진 문자(MMS) 설정 전입니다 (솔라피 발신번호·키 미등록).' }, 503)
  }

  let body: { customerId?: unknown; text?: unknown; image?: unknown; subject?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const customerId = String(body.customerId ?? '').trim()
  const text = String(body.text ?? '').trim()
  const image = String(body.image ?? '')
  const subject = body.subject ? String(body.subject) : undefined
  if (!customerId) return json({ success: false, error: '고객을 선택해주세요.' }, 400)
  if (!text) return json({ success: false, error: '메시지 내용을 입력해주세요.' }, 400)
  if (!image) return json({ success: false, error: '사진을 첨부해주세요.' }, 400)
  if (image.length > MAX_IMG_B64) return json({ success: false, error: '사진 용량이 큽니다. 다시 시도해주세요.' }, 413)

  // 호출자 토큰으로 고객 전화 조회 — RLS가 접근권을 판정한다(못 보는 고객이면 null).
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const { data: userData } = await caller.auth.getUser()
  if (!userData?.user?.id) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  const { data: cust } = await caller.from('customers').select('name, phone').eq('id', customerId).maybeSingle()
  const to = digits(String((cust as { phone?: string } | null)?.phone ?? ''))
  if (!cust) return json({ success: false, error: '고객을 찾을 수 없거나 접근 권한이 없습니다.' }, 403)
  if (!to) return json({ success: false, error: '이 고객의 전화번호가 없습니다.' }, 400)

  const auth = await solapiAuthHeader(apiKey, apiSecret)
  const up = await uploadImage(auth, 'photo.jpg', image)
  if (!up.ok || !up.fileId) return json({ success: false, error: up.error ?? '이미지 업로드 실패' }, 502)

  const sent = await sendMms(auth, from, to, text, up.fileId, subject)
  if (!sent.ok) return json({ success: false, error: sent.error ?? 'MMS 발송 실패' }, 502)
  return json({ success: true, providerId: sent.providerId })
})
