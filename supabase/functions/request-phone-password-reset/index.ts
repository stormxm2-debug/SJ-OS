// Supabase Edge Function: request-phone-password-reset (Deno runtime)
//
// Records a password-reset REQUEST for a registered phone. It NEVER resets a password
// directly (that requires owner/admin approval + a separate secure flow). Always
// returns a GENERIC success message — no account enumeration. service_role exists ONLY
// here (function env); no secrets in this file.
//
// Deploy: supabase functions deploy request-phone-password-reset
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*', // restrict to your app origin in production
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const GENERIC = { ok: true, message: '등록된 직원이면 관리자에게 비밀번호 재설정 요청이 전달됩니다.' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function normalizePhone(input: string): string | null {
  const raw = (input ?? '').replace(/[\s-]/g, '')
  if (!raw) return null
  let n: string
  if (raw.startsWith('+82')) n = '+82' + raw.slice(3).replace(/^0/, '')
  else if (raw.startsWith('82')) n = '+82' + raw.slice(2).replace(/^0/, '')
  else if (raw.startsWith('010')) n = '+82' + raw.slice(1)
  else if (raw.startsWith('10') && (raw.length === 9 || raw.length === 10)) n = '+82' + raw
  else return null
  return /^\+8210\d{7,8}$/.test(n) ? n : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(GENERIC) // never reveal anything

  let body: any
  try {
    body = await req.json()
  } catch {
    return json(GENERIC)
  }
  const phone = normalizePhone(body?.phone ?? '')
  if (!phone) return json(GENERIC) // do not reveal invalid vs unknown

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRole) return json(GENERIC)

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { data: acct } = await admin.from('staff_login_accounts').select('id, status').eq('normalized_phone', phone).maybeSingle()
    if (acct && acct.status !== 'blocked') {
      await admin.from('password_reset_requests').insert({ normalized_phone: phone, status: 'pending' })
      await admin.from('staff_login_accounts').update({ password_status: 'reset-requested', updated_at: new Date().toISOString() }).eq('id', acct.id)
    }
  } catch (e) {
    console.error('request-phone-password-reset failed:', (e as Error)?.name ?? 'error')
  }
  // Always generic — no enumeration.
  return json(GENERIC)
})
