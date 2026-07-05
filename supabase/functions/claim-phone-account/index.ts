// Supabase Edge Function: claim-phone-account (Deno runtime)
//
// Lets a REGISTERED staff phone set its FIRST password. The service_role key exists
// ONLY here (function env) — never in the renderer/Netlify/committed files. This file
// contains NO secrets; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected as
// function secrets at deploy time.
//
// Deploy: supabase functions deploy claim-phone-account
// Secrets: supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//
// This file is Deno/TS and is NOT part of the app's tsconfig/vite build.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS: '*' is for early testing only. In production, restrict to your app origin(s)
// (e.g. the Netlify URL). See the deployment guide.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// E.164 normalization (mirrors the frontend helper). Never logs the value.
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

function passwordError(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  if (pw.length > 72) return '비밀번호는 72자 이하여야 합니다.'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에는 영문과 숫자를 포함해야 합니다.'
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, message: '잘못된 요청입니다.' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400)
  }

  const phone = normalizePhone(body?.phone ?? '')
  if (!phone) return json({ ok: false, message: '휴대폰 번호 형식을 확인해주세요.' }, 400)
  const pwErr = passwordError(body?.password ?? '')
  if (pwErr) return json({ ok: false, message: pwErr }, 400)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRole) return json({ ok: false, message: '서버 설정 오류입니다. 관리자에게 문의하세요.' }, 500)

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const { data: acct } = await admin.from('staff_login_accounts').select('*').eq('normalized_phone', phone).maybeSingle()
    if (!acct) return json({ ok: false, message: '등록된 직원만 이용할 수 있습니다.' })
    if (acct.status === 'inactive' || acct.status === 'blocked') {
      return json({ ok: false, message: '비활성 직원 계정입니다. 관리자에게 문의하세요.' })
    }
    // Already claimed → do NOT overwrite the password (reset must be admin-approved).
    if (acct.password_status === 'set' && acct.profile_id) {
      return json({ ok: false, message: '이미 비밀번호가 설정된 계정입니다. 로그인해주세요.' })
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone,
      password: body.password,
      phone_confirm: true
      // user_metadata is NOT trusted for authorization — role comes from staff_login_accounts.
    })
    const userId = created?.user?.id
    if (createErr || !userId) {
      // An auth user may already exist for this phone. Do NOT blindly overwrite the
      // password. Ask to log in or have an admin resolve the link manually.
      return json({ ok: false, message: '이미 등록된 계정일 수 있습니다. 로그인하거나 관리자에게 문의하세요.' })
    }

    await admin.from('profiles').upsert({
      id: userId,
      name: acct.name,
      role: acct.role,
      team_id: acct.team_id ?? null,
      phone,
      status: 'active'
    })
    await admin
      .from('staff_login_accounts')
      .update({ profile_id: userId, password_status: 'set', status: 'active', updated_at: new Date().toISOString() })
      .eq('id', acct.id)

    return json({ ok: true, message: '비밀번호 설정이 완료되었습니다. 로그인해주세요.' })
  } catch (e) {
    // Log only a minimal error type — never phone/password/service_role/session.
    console.error('claim-phone-account failed:', (e as Error)?.name ?? 'error')
    return json({ ok: false, message: '처리 중 오류가 발생했습니다. 관리자에게 문의하세요.' }, 500)
  }
})
