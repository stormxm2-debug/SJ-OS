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
    // SECURITY(2026-07-21): OR, not AND. An account that is half-claimed (password set but
    // profile_id not linked, or linked but status not yet 'set') must also be refused —
    // with AND, such a row fell through to createUser and anyone who merely knew the phone
    // number could take the account over. Only a never-claimed row may proceed.
    //
    // 2026-08-05: 단, 관리자가 승인한 비밀번호 재설정(7일 이내, 미사용)이 있으면
    // 기존 계정의 비밀번호를 새로 설정할 수 있다 — 승인 없이는 여전히 불가.
    // (기존에는 승인돼도 여기서 무조건 거절되어 재설정이 영구히 막혀 있었다.)
    if (acct.password_status === 'set' || acct.profile_id) {
      const { data: reset } = await admin
        .from('password_reset_requests')
        .select('id, approved_at')
        .eq('normalized_phone', phone)
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const RESET_TTL_MS = 7 * 24 * 3600 * 1000
      const fresh = !!reset?.approved_at && Date.now() - new Date(reset.approved_at).getTime() < RESET_TTL_MS
      if (!reset || !fresh) {
        return json({
          ok: false,
          message: reset
            ? '재설정 승인이 만료되었습니다. 관리자에게 다시 요청해주세요.'
            : '이미 비밀번호가 설정된 계정입니다. 비밀번호를 잊으셨으면 로그인 화면의 [비밀번호 찾기]로 요청 후 관리자 승인을 받아주세요.'
        })
      }
      if (!acct.profile_id) {
        // 승인은 있으나 연결된 auth 계정이 없는 비정상 행 — 자동 생성으로 흘려보내지
        // 않고 명시적으로 멈춘다(탈취 방지 원칙 유지).
        return json({ ok: false, message: '계정 연결 상태에 문제가 있습니다. 관리자에게 문의하세요.' })
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(acct.profile_id, { password: body.password })
      if (updErr) return json({ ok: false, message: '비밀번호 재설정에 실패했습니다. 관리자에게 문의하세요.' })
      await admin.from('password_reset_requests').update({ status: 'used' }).eq('id', reset.id)
      await admin
        .from('staff_login_accounts')
        .update({ password_status: 'set', status: 'active', updated_at: new Date().toISOString() })
        .eq('id', acct.id)
      await admin.from('profiles').update({ password_rotated_at: new Date().toISOString() }).eq('id', acct.profile_id)
      return json({ ok: true, message: '새 비밀번호가 설정되었습니다. 로그인해주세요.' })
    }
    // Belt-and-braces: refuse if an auth user already exists for this phone, so a
    // stale/mismatched staff row can never be used to mint a second credential.
    {
      const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const bare = phone.replace('+', '')
      if (existing?.users?.some((u: any) => u.phone === bare || u.phone === phone)) {
        return json({ ok: false, message: '이미 등록된 계정입니다. 로그인하거나 관리자에게 문의하세요.' })
      }
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
