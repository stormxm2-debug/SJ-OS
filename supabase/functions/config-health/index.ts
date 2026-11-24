// SJ INVEST — 설정(시크릿) 헬스체크 (config-health)
//
// 각 외부 연동 키의 '등록 여부(true/false)'만 반환한다. 키 "값"은 절대 반환하지 않는다.
// 대표/관리자(owner·admin)만 호출 가능 — 설정 상태는 민감 정보라 공개하지 않는다.
//
// 출력: { ok: true, present: { [KEY]: boolean }, groups: {...} } | { ok:false, error }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// 점검할 시크릿 키 목록 (값이 아니라 존재 여부만 확인).
const KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'SOLAPI_API_KEY',
  'SOLAPI_API_SECRET',
  'SOLAPI_PF_ID',
  'SOLAPI_SENDER_PHONE',
  'SOLAPI_FAX_SENDER',
  'SOLAPI_TPL_EXEMPTION_DUE',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'PUSH_INTERNAL_SECRET',
  'HIGGSFIELD_API_KEY_ID',
  'HIGGSFIELD_API_KEY_SECRET'
]

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // 인증 + 권한: 로그인한 owner/admin 만.
  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const sk = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = su && sk ? createClient(su, sk, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } }) : null
  const uid = caller ? (await caller.auth.getUser()).data?.user?.id : null
  if (!uid || !caller) return json({ ok: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  const { data: prof } = await caller.from('profiles').select('role').eq('id', uid).maybeSingle()
  const role = (prof as { role?: string } | null)?.role
  if (role !== 'owner' && role !== 'admin') return json({ ok: false, error: '대표·관리자만 확인할 수 있습니다.' }, 403)

  const present: Record<string, boolean> = {}
  for (const k of KEYS) present[k] = Boolean(Deno.env.get(k))

  // 기능 그룹별 요약 (모든 필수 키가 있으면 ready).
  const groups = {
    claude: present.ANTHROPIC_API_KEY,
    openai: present.OPENAI_API_KEY,
    messaging: present.SOLAPI_API_KEY && present.SOLAPI_API_SECRET && present.SOLAPI_SENDER_PHONE,
    alimtalk: present.SOLAPI_API_KEY && present.SOLAPI_API_SECRET && present.SOLAPI_PF_ID,
    fax: present.SOLAPI_API_KEY && present.SOLAPI_API_SECRET && present.SOLAPI_FAX_SENDER,
    push: present.VAPID_PUBLIC_KEY && present.VAPID_PRIVATE_KEY && present.VAPID_SUBJECT,
    image: present.HIGGSFIELD_API_KEY_ID && present.HIGGSFIELD_API_KEY_SECRET
  }

  return json({ ok: true, present, groups })
})
