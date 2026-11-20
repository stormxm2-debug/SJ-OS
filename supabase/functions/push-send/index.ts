// SJ INVEST — 고객등록 웹 푸시 발송 (push-send)
//
// POST { registrationId, kind: 'new' | 'memo' | 'done' | 'rejected' }
//   - new      : FC 본인이 방금 저장한 요청 → 대표·관리자·총무에게 발송
//   - memo     : 총무(처리자)가 메모 저장 → 요청 FC에게 발송
//   - done/rejected : 총무(처리자)가 처리 → 요청 FC에게 발송
//   호출자는 로그인 사용자여야 하고, 요청 행을 RLS로 볼 수 있어야 한다.
//   kind 별 권한: new = 요청한 본인 / 나머지 = 대표·관리자·총무.
//
// 필요한 시크릿 (Supabase 대시보드 → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   웹 푸시 공개키 (클라이언트에도 같은 값이 들어 있다)
//   VAPID_PRIVATE_KEY  웹 푸시 비밀키 (절대 클라이언트·저장소에 두지 않는다)
//   VAPID_SUBJECT      (선택) 'https://...' 또는 'mailto:...' — 없으면 사이트 주소
// 시크릿이 없으면 503 PUSH_NOT_CONFIGURED.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

type Kind = 'new' | 'memo' | 'done' | 'rejected'
const KINDS: Kind[] = ['new', 'memo', 'done', 'rejected']
const REVIEWER_ROLES = ['owner', 'admin', 'back-office']

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'https://sj-invest.pages.dev'
  if (!pub || !priv) return json({ error: 'PUSH_NOT_CONFIGURED' }, 503)

  const body = (await req.json().catch(() => null)) as { registrationId?: unknown; kind?: unknown } | null
  const registrationId = typeof body?.registrationId === 'string' ? body.registrationId : ''
  const kind = body?.kind as Kind
  if (!registrationId || !KINDS.includes(kind)) return json({ error: 'BAD_REQUEST' }, 400)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  // 호출자 권한 범위의 클라이언트: 요청 행이 보이는지를 RLS가 판단한다.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const { data: userData } = await caller.auth.getUser()
  const me = userData?.user?.id
  if (!me) return json({ error: 'UNAUTHORIZED' }, 401)

  const { data: row } = await caller
    .from('customer_registrations')
    .select('id, customer_id, staff_id, status, note')
    .eq('id', registrationId)
    .maybeSingle()
  if (!row) return json({ error: 'NOT_FOUND' }, 404)

  const admin = createClient(url, service, { auth: { persistSession: false } })

  // 호출자 역할 확인 (처리자 여부)
  const { data: me_ } = await admin.from('profiles').select('role').eq('id', me).maybeSingle()
  const myRole = String(me_?.role ?? '')
  if (kind === 'new') {
    if (row.staff_id !== me) return json({ error: 'FORBIDDEN' }, 403)
  } else if (!REVIEWER_ROLES.includes(myRole)) {
    return json({ error: 'FORBIDDEN' }, 403)
  }

  const [cust, staff] = await Promise.all([
    admin.from('customers').select('name').eq('id', row.customer_id).maybeSingle(),
    admin.from('profiles').select('name').eq('id', row.staff_id).maybeSingle()
  ])
  const custName = String(cust.data?.name ?? '고객')
  const staffName = String(staff.data?.name ?? 'FC')

  let userIds: string[] = []
  let title = ''
  let text = ''
  if (kind === 'new') {
    const { data: reviewers } = await admin.from('profiles').select('id').in('role', REVIEWER_ROLES)
    userIds = (reviewers ?? []).map((r: { id: string }) => r.id).filter((id: string) => id !== row.staff_id)
    title = '새 고객등록 요청'
    text = `${staffName} → ${custName}`
  } else {
    userIds = [row.staff_id as string]
    if (kind === 'memo') {
      title = '총무 메모 도착 📝'
      text = `${custName} · ${String(row.note ?? '').slice(0, 80)}`
    } else if (kind === 'done') {
      title = '고객등록 완료 ✓'
      text = custName
    } else {
      title = '고객등록 반려'
      text = custName
    }
  }
  if (userIds.length === 0) return json({ ok: true, sent: 0, removed: 0 })

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds)
  webpush.setVapidDetails(subject, pub, priv)
  const payload = JSON.stringify({ title, body: text.slice(0, 120), url: '/', tag: `reg-${row.id}-${kind}` })

  let sent = 0
  const gone: string[] = []
  await Promise.all(
    (subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
        sent++
      } catch (e) {
        // 404/410 = 구독이 만료됨 → 정리
        const code = (e as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) gone.push(s.id)
      }
    })
  )
  if (gone.length > 0) await admin.from('push_subscriptions').delete().in('id', gone)
  return json({ ok: true, sent, removed: gone.length })
})
