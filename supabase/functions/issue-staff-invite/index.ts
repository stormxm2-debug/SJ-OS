// SJ INVEST — issue-staff-invite
//
// 초기 비밀번호 없이 등록한 직원에게 줄 6자리 초대 코드를 발급한다(2026-09-18 점검 조치).
// 직원은 로그인 화면에서 이 코드와 새 비밀번호를 입력해야 첫 비밀번호를 만들 수 있다
// (claim-phone-account가 코드를 검증). 전화번호만 아는 제3자의 계정 가로채기를 막는다.
//
// 보안: ①호출자 JWT 검증 + profiles.role이 owner/admin/back-office 일 때만 ②총무는 FC 계정만
// ③이미 비밀번호가 만들어진 계정에는 발급하지 않음 ④코드는 해시만 staff_invite_codes에 저장
// (정책 없는 RLS 표 — 서버 함수만 읽고 쓴다). 코드 원문은 응답으로 한 번만 돌려준다.
// Secrets: SUPABASE_URL/ANON/SERVICE_ROLE 자동 주입. 이 파일에 비밀 없음. 전화번호·코드는 로그에 남기지 않는다.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

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

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, message: '잘못된 요청입니다.' }, 405)

  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!su || !anonKey || !serviceKey) return json({ ok: false, message: '서버 설정 오류입니다.' }, 500)

  // ① 호출자 검증
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = createClient(su, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const uid = (await caller.auth.getUser()).data?.user?.id
  if (!uid) return json({ ok: false, message: '로그인 후 사용할 수 있습니다.' }, 401)

  const admin = createClient(su, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: me } = await admin.from('profiles').select('role, status').eq('id', uid).maybeSingle()
  const role = String(me?.role ?? '')
  if (!['owner', 'admin', 'back-office'].includes(role) || me?.status === 'inactive') {
    return json({ ok: false, message: '초대 코드를 발급할 권한이 없습니다.' }, 403)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400)
  }
  const phone = normalizePhone(body?.phone ?? '')
  if (!phone) return json({ ok: false, message: '휴대폰 번호 형식을 확인해주세요.' }, 400)

  try {
    const { data: acct } = await admin
      .from('staff_login_accounts')
      .select('role, status, profile_id, password_status')
      .eq('normalized_phone', phone)
      .maybeSingle()
    if (!acct) return json({ ok: false, message: '먼저 직원 번호를 등록해주세요.' })
    if (acct.profile_id || acct.password_status === 'set') {
      return json({ ok: false, message: '이미 비밀번호를 만든 직원입니다. 비밀번호를 잊었다면 재설정 요청을 승인해주세요.' })
    }
    if (acct.status === 'inactive' || acct.status === 'blocked') return json({ ok: false, message: '비활성·차단된 직원입니다.' })
    // ② 총무는 FC만 (승격 차단 원칙)
    if (role === 'back-office' && (acct.role ?? 'fc') !== 'fc') {
      return json({ ok: false, message: '총무는 FC 계정의 초대 코드만 발급할 수 있습니다.' }, 403)
    }

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
    const { error } = await admin.from('staff_invite_codes').upsert({
      normalized_phone: phone,
      code_hash: await sha256Hex(`${phone}:${code}`),
      created_at: new Date().toISOString(),
      created_by: uid,
      failed_attempts: 0
    })
    if (error) return json({ ok: false, message: '초대 코드를 저장하지 못했습니다.' }, 500)
    return json({ ok: true, code, expiresInDays: 7 })
  } catch (e) {
    console.error('issue-staff-invite failed:', (e as Error)?.name ?? 'error')
    return json({ ok: false, message: '처리 중 오류가 발생했습니다.' }, 500)
  }
})
