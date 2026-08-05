// SJ INVEST — admin-create-staff-account
//
// 관리자(owner/admin)가 직원 등록과 동시에 초기 비밀번호를 지정해 "등록 즉시
// 로그인 가능한" 계정을 만든다(2026-08-05 대표 지시). 기존 자율 설정 방식
// (claim-phone-account)은 그대로 유지 — 초기 비밀번호를 비우면 그 경로를 쓴다.
//
// 보안: ①호출자 JWT 검증 + profiles.role이 owner/admin일 때만 허용(총무·직원 불가)
// ②owner 계정 생성 금지, admin 호출자는 admin 생성도 금지(승격 이중 차단 원칙)
// ③초기 비밀번호는 sjos+뒤4자리 등 예측 패턴 거부 ④전화 중복(auth/명부) 거절.
// 생성된 계정은 password_rotated_at이 비어 있어 첫 접속 시 변경 안내 게이트가 뜬다.
// Secrets: SUPABASE_URL/ANON/SERVICE_ROLE 자동 주입. 이 파일에 비밀 없음.
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

function passwordError(pw: string, phone: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '초기 비밀번호는 8자 이상이어야 합니다.'
  if (pw.length > 72) return '초기 비밀번호는 72자 이하여야 합니다.'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '초기 비밀번호에는 영문과 숫자를 포함해야 합니다.'
  const last4 = phone.slice(-4)
  if (pw.toLowerCase() === `sjos${last4}`) return '예측 가능한 초기 비밀번호는 쓸 수 없습니다.'
  return null
}

const ALLOWED_ROLES = ['admin', 'team-leader', 'fc', 'back-office']

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, message: '잘못된 요청입니다.' }, 405)

  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!su || !anonKey || !serviceKey) return json({ ok: false, message: '서버 설정 오류입니다.' }, 500)

  // ① 호출자 검증 — 로그인한 owner/admin만.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = createClient(su, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const uid = (await caller.auth.getUser()).data?.user?.id
  if (!uid) return json({ ok: false, message: '로그인 후 사용할 수 있습니다.' }, 401)

  const admin = createClient(su, serviceKey, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
  if (me?.role !== 'owner' && me?.role !== 'admin') {
    return json({ ok: false, message: '관리자만 초기 비밀번호로 계정을 만들 수 있습니다.' }, 403)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400)
  }

  const name = String(body?.name ?? '').trim()
  if (!name) return json({ ok: false, message: '직원명을 입력해주세요.' }, 400)
  const phone = normalizePhone(body?.phone ?? '')
  if (!phone) return json({ ok: false, message: '휴대폰 번호 형식을 확인해주세요.' }, 400)
  const role = String(body?.role ?? 'fc')
  if (!ALLOWED_ROLES.includes(role)) return json({ ok: false, message: '허용되지 않는 등급입니다.' }, 400)
  if (role === 'admin' && me.role !== 'owner') {
    return json({ ok: false, message: '관리자 등급 생성은 대표만 할 수 있습니다.' }, 403)
  }
  const pwErr = passwordError(body?.password ?? '', phone)
  if (pwErr) return json({ ok: false, message: pwErr }, 400)

  try {
    // ② 중복 확인 — 이미 클레임된 명부 행 또는 기존 auth 전화가 있으면 거절.
    const { data: acct } = await admin.from('staff_login_accounts').select('*').eq('normalized_phone', phone).maybeSingle()
    if (acct && (acct.password_status === 'set' || acct.profile_id)) {
      return json({ ok: false, message: '이미 등록되어 로그인 중인 직원입니다.' })
    }
    {
      const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const bare = phone.replace('+', '')
      if (existing?.users?.some((u: any) => u.phone === bare || u.phone === phone)) {
        return json({ ok: false, message: '이미 이 번호로 계정이 있습니다. 관리자에게 문의하세요.' })
      }
    }

    // ③ 계정 생성 + 프로필 + 명부 연결 (미클레임 초대 행이 있으면 그 행을 재사용)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone,
      password: body.password,
      phone_confirm: true
    })
    const newId = created?.user?.id
    if (createErr || !newId) return json({ ok: false, message: '계정 생성에 실패했습니다. 관리자에게 문의하세요.' })

    await admin.from('profiles').upsert({ id: newId, name, role, phone, status: 'active' })
    if (acct) {
      await admin
        .from('staff_login_accounts')
        .update({ name, role, status: 'active', password_status: 'set', profile_id: newId, updated_at: new Date().toISOString() })
        .eq('id', acct.id)
    } else {
      await admin.from('staff_login_accounts').insert({
        name,
        phone: String(body?.phone ?? ''),
        normalized_phone: phone,
        role,
        status: 'active',
        password_status: 'set',
        profile_id: newId,
        created_by: uid
      })
    }

    return json({ ok: true, message: '계정이 생성되었습니다. 초기 비밀번호를 직원에게 전달해주세요.' })
  } catch (e) {
    console.error('admin-create-staff-account failed:', (e as Error)?.name ?? 'error')
    return json({ ok: false, message: '처리 중 오류가 발생했습니다.' }, 500)
  }
})
