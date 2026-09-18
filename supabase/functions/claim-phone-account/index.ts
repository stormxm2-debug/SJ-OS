// Supabase Edge Function: claim-phone-account (Deno runtime)
//
// 등록된 직원 번호의 비밀번호를 설정한다. 2026-09-18부터 관리자·총무가 직원 본인에게 직접 전달한
// 6자리 코드가 있어야 한다 — 첫 비밀번호는 초대 코드(issue-staff-invite), 재설정은 승인 확인 코드.
// (예전에는 전화번호만 알면 제3자가 먼저 비밀번호를 정할 수 있었다.) The service_role key exists
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

const RESET_TTL_MS = 24 * 3600 * 1000 // 재설정 승인 유효 24시간
const MAX_CODE_ATTEMPTS = 5
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000 // 초대 코드 유효 7일
const FAIL_MESSAGE =
  '비밀번호를 설정할 수 없습니다. 관리자에게 받은 6자리 코드(초대 코드 또는 재설정 확인 코드)를 다시 확인하거나 관리자에게 문의하세요.'

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
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
    // 등록 여부·상태를 구분해 알려주지 않는다(직원 번호 알아내기 방지).
    if (!acct || acct.status === 'inactive' || acct.status === 'blocked') return json({ ok: false, message: FAIL_MESSAGE })

    const code = String(body?.code ?? '').replace(/\D/g, '')

    // 첫 비밀번호: 관리자·총무가 발급한 초대 코드(issue-staff-invite)가 있어야 한다.
    // 2026-09-18 점검 조치 — 예전에는 번호만 아는 누구나 먼저 비밀번호를 정해 계정을 가져갈 수 있었다.
    if (!acct.profile_id) {
      if (acct.password_status === 'set') return json({ ok: false, message: FAIL_MESSAGE }) // 반쯤 연결된 비정상 행
      const { data: invite } = await admin
        .from('staff_invite_codes')
        .select('code_hash, created_at, failed_attempts')
        .eq('normalized_phone', phone)
        .maybeSingle()
      const inviteFresh = !!invite?.created_at && Date.now() - new Date(invite.created_at).getTime() < INVITE_TTL_MS
      if (!invite || !inviteFresh) return json({ ok: false, message: FAIL_MESSAGE })
      const inviteOk = /^\d{6}$/.test(code) && (await sha256Hex(`${phone}:${code}`)) === invite.code_hash
      if (!inviteOk) {
        const attempts = (invite.failed_attempts ?? 0) + 1
        if (attempts >= MAX_CODE_ATTEMPTS) {
          await admin.from('staff_invite_codes').delete().eq('normalized_phone', phone)
          return json({ ok: false, message: '초대 코드를 5번 틀려 코드가 취소되었습니다. 관리자에게 새 코드를 받아주세요.' })
        }
        await admin.from('staff_invite_codes').update({ failed_attempts: attempts }).eq('normalized_phone', phone)
        return json({ ok: false, message: FAIL_MESSAGE })
      }

      // 같은 번호의 로그인 계정이 이미 있으면 두 번째 계정을 만들지 않는다.
      const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const bare = phone.replace('+', '')
      if (existing?.users?.some((u: any) => u.phone === bare || u.phone === phone)) {
        return json({ ok: false, message: '이미 등록된 계정입니다. 로그인하거나 관리자에게 문의하세요.' })
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({ phone, password: body.password, phone_confirm: true })
      const userId = created?.user?.id
      if (createErr || !userId) return json({ ok: false, message: '이미 등록된 계정일 수 있습니다. 로그인하거나 관리자에게 문의하세요.' })
      await admin.from('profiles').upsert({ id: userId, name: acct.name, role: acct.role, team_id: acct.team_id ?? null, phone, status: 'active' })
      await admin
        .from('staff_login_accounts')
        .update({ profile_id: userId, password_status: 'set', status: 'active', updated_at: new Date().toISOString() })
        .eq('id', acct.id)
      await admin.from('staff_invite_codes').delete().eq('normalized_phone', phone)
      return json({ ok: true, message: '비밀번호 설정이 완료되었습니다. 로그인해주세요.' })
    }

    // 관리자 승인 + 관리자가 직원에게 직접 전달한 6자리 확인 코드가 있어야 재설정된다.
    const { data: reset } = await admin
      .from('password_reset_requests')
      .select('id, approved_at, approval_code_hash, failed_attempts')
      .eq('normalized_phone', phone)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fresh = !!reset?.approved_at && Date.now() - new Date(reset.approved_at).getTime() < RESET_TTL_MS
    if (!reset || !fresh || !reset.approval_code_hash) return json({ ok: false, message: FAIL_MESSAGE })

    const matches = /^\d{6}$/.test(code) && (await sha256Hex(`${reset.id}:${code}`)) === reset.approval_code_hash
    if (!matches) {
      const attempts = (reset.failed_attempts ?? 0) + 1
      await admin
        .from('password_reset_requests')
        .update(attempts >= MAX_CODE_ATTEMPTS ? { failed_attempts: attempts, status: 'rejected' } : { failed_attempts: attempts })
        .eq('id', reset.id)
      return json({
        ok: false,
        message: attempts >= MAX_CODE_ATTEMPTS ? '확인 코드를 5번 틀려 재설정 승인이 취소되었습니다. 관리자에게 다시 요청해주세요.' : FAIL_MESSAGE
      })
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(acct.profile_id, { password: body.password })
    if (updErr) return json({ ok: false, message: '비밀번호 재설정에 실패했습니다. 관리자에게 문의하세요.' })
    await admin.from('password_reset_requests').update({ status: 'used', approval_code_hash: null }).eq('id', reset.id)
    await admin
      .from('staff_login_accounts')
      .update({ password_status: 'set', status: 'active', updated_at: new Date().toISOString() })
      .eq('id', acct.id)
    await admin.from('profiles').update({ password_rotated_at: new Date().toISOString() }).eq('id', acct.profile_id)
    return json({ ok: true, message: '새 비밀번호가 설정되었습니다. 로그인해주세요.' })
  } catch (e) {
    // Log only a minimal error type — never phone/password/code/service_role/session.
    console.error('claim-phone-account failed:', (e as Error)?.name ?? 'error')
    return json({ ok: false, message: '처리 중 오류가 발생했습니다. 관리자에게 문의하세요.' }, 500)
  }
})
