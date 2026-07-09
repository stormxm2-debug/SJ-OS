// SJ INVEST — 미팅 알림톡 발송 (send-alimtalk)
//
// 개별 발송(앱 버튼): POST { scheduleId, kind: 'confirm' | 'reminder' | 'change' }
//   - 로그인 사용자만. 본인 일정 또는 owner/admin만 발송 가능.
// 배치 리마인더(pg_cron): POST { mode: 'remind-tomorrow' } + Bearer = service_role
//   - 내일 예정(planned) 미팅 중 고객 연락처가 있는 건에 리마인더 일괄 발송.
//
// 전화번호는 서버에서만 조회한다(클라이언트가 번호를 보내는 방식 금지).
// 솔라피(SOLAPI) 공식 딜러사 API 사용 — 필요한 시크릿:
//   SOLAPI_API_KEY / SOLAPI_API_SECRET  솔라피 콘솔 > API Key
//   SOLAPI_PF_ID                        연동한 카카오톡 채널 pfId
//   SOLAPI_SENDER_PHONE                 SMS 폴백용 발신번호 (솔라피에 등록된 번호)
//   SOLAPI_TPL_MEETING_CONFIRM / SOLAPI_TPL_MEETING_REMIND / SOLAPI_TPL_MEETING_CHANGE
//                                       카카오 심사 통과한 템플릿 ID 3종
// 시크릿이 없으면 503 ALIMTALK_NOT_CONFIGURED — 앱은 "설정 전" 안내만 표시.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

type Kind = 'confirm' | 'reminder' | 'change'
const TEMPLATE_ENV: Record<Kind, string> = {
  confirm: 'SOLAPI_TPL_MEETING_CONFIRM',
  reminder: 'SOLAPI_TPL_MEETING_REMIND',
  change: 'SOLAPI_TPL_MEETING_CHANGE'
}

const TYPE_LABEL: Record<string, string> = {
  ap: 'AP',
  'meeting-1': '1차만남',
  'meeting-2': '2차만남',
  'meeting-3': '3차만남',
  closing: '클로징',
  delivery: '증권 전달',
  'intro-meeting': '소개만남',
  meeting: '만남',
  consultation: '상담',
  contract: '계약',
  'follow-up': '팔로업'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** "7월 15일(화) 오후 2:00" (KST). */
function formatKst(iso: string): string {
  const d = new Date(Date.parse(iso))
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${date} ${time}`
}

/** 로그 저장용 마스킹: 010-1234-5678 → 010****5678. */
function maskPhone(digits: string): string {
  return digits.length >= 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : '***'
}

/** 솔라피 HMAC-SHA256 인증 헤더. */
async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString()
  const salt = crypto.randomUUID().replaceAll('-', '')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt))
  const signature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

interface SendArgs {
  to: string
  templateId: string
  variables: Record<string, string>
}

/** 솔라피 단건 발송 (알림톡 → 실패 시 자동 SMS 폴백은 솔라피 설정을 따름). */
async function solapiSend(args: SendArgs): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  const pfId = Deno.env.get('SOLAPI_PF_ID') ?? ''
  const from = (Deno.env.get('SOLAPI_SENDER_PHONE') ?? '').replace(/\D/g, '')
  const auth = await solapiAuthHeader(apiKey, apiSecret)
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({
      message: {
        to: args.to,
        from,
        kakaoOptions: { pfId, templateId: args.templateId, variables: args.variables, disableSms: false }
      }
    })
  })
  const data = (await res.json().catch(() => ({}))) as { groupId?: string; messageId?: string; errorMessage?: string; message?: string }
  if (!res.ok) return { ok: false, error: data.errorMessage || data.message || `솔라피 오류 (HTTP ${res.status})` }
  return { ok: true, providerId: data.messageId ?? data.groupId }
}

interface ScheduleRow {
  id: string
  staff_id: string
  customer_id: string | null
  type: string
  starts_at: string
  status: string
  location: string | null
  customer: { id: string; name: string; phone: string | null } | null
}

const SCHEDULE_COLS = 'id, staff_id, customer_id, type, starts_at, status, location, customer:customers(id, name, phone)'

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!url || !serviceKey) return json({ success: false, error: '서버 설정 오류.' }, 500)

  const configured =
    Boolean(Deno.env.get('SOLAPI_API_KEY')) &&
    Boolean(Deno.env.get('SOLAPI_API_SECRET')) &&
    Boolean(Deno.env.get('SOLAPI_PF_ID'))
  if (!configured) {
    return json({ success: false, code: 'ALIMTALK_NOT_CONFIGURED', error: '알림톡 설정 전입니다 (솔라피 키 미등록).' }, 503)
  }

  let body: { scheduleId?: unknown; kind?: unknown; mode?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  // ---------- 배치 리마인더 (pg_cron → service_role 호출) ----------
  if (String(body.mode ?? '') === 'remind-tomorrow') {
    if (bearer !== serviceKey) return json({ success: false, error: '권한이 없습니다.' }, 403)
    const now = new Date()
    const kstNow = new Date(now.getTime() + 9 * 3600_000)
    const startKst = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + 1))
    const start = new Date(startKst.getTime() - 9 * 3600_000).toISOString()
    const end = new Date(startKst.getTime() + 24 * 3600_000 - 9 * 3600_000).toISOString()
    const { data, error } = await admin
      .from('schedule_events')
      .select(SCHEDULE_COLS)
      .eq('status', 'planned')
      .not('customer_id', 'is', null)
      .gte('starts_at', start)
      .lt('starts_at', end)
    if (error) return json({ success: false, error: '내일 일정 조회에 실패했습니다.' }, 500)
    let sent = 0
    let skipped = 0
    for (const row of (data ?? []) as unknown as ScheduleRow[]) {
      const r = await trySendOne(admin, row, 'reminder', null)
      if (r.ok) sent += 1
      else skipped += 1
    }
    return json({ success: true, sent, skipped })
  }

  // ---------- 개별 발송 (앱 버튼) ----------
  const scheduleId = String(body.scheduleId ?? '').trim()
  const kind = String(body.kind ?? 'confirm') as Kind
  if (!scheduleId || !TEMPLATE_ENV[kind]) return json({ success: false, error: 'scheduleId/kind가 올바르지 않습니다.' }, 400)

  // 호출자 확인 (anon 클라이언트 + 사용자 토큰)
  const caller = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const { data: userData } = await caller.auth.getUser()
  const callerId = userData?.user?.id
  if (!callerId) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  const { data: row, error: rowErr } = await admin.from('schedule_events').select(SCHEDULE_COLS).eq('id', scheduleId).maybeSingle()
  if (rowErr || !row) return json({ success: false, error: '일정을 찾을 수 없습니다.' }, 404)
  const schedule = row as unknown as ScheduleRow

  // 권한: 본인 일정이거나 owner/admin
  if (schedule.staff_id !== callerId) {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
    const role = String((prof as { role?: string } | null)?.role ?? '')
    if (role !== 'owner' && role !== 'admin') return json({ success: false, error: '본인 일정만 발송할 수 있습니다.' }, 403)
  }

  const result = await trySendOne(admin, schedule, kind, callerId)
  if (!result.ok) return json({ success: false, error: result.error }, result.status ?? 502)
  return json({ success: true })
})

/** 단건 발송 + alimtalk_logs 기록. 중복 발송(10분 내 같은 일정·같은 종류 성공) 차단. */
async function trySendOne(
  admin: ReturnType<typeof createClient>,
  schedule: ScheduleRow,
  kind: Kind,
  sentBy: string | null
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const customer = schedule.customer
  const phone = (customer?.phone ?? '').replace(/\D/g, '')
  if (!customer || !phone) return { ok: false, error: '고객 연락처가 없습니다. 고객 정보에 전화번호를 먼저 입력해 주세요.', status: 400 }
  if (schedule.status !== 'planned') return { ok: false, error: '예정 상태의 일정만 발송할 수 있습니다.', status: 400 }

  const templateId = Deno.env.get(TEMPLATE_ENV[kind]) ?? ''
  if (!templateId) return { ok: false, error: `템플릿(${kind}) ID가 등록되지 않았습니다.`, status: 503 }

  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: dup } = await admin
    .from('alimtalk_logs')
    .select('id')
    .eq('schedule_id', schedule.id)
    .eq('kind', kind)
    .eq('status', 'success')
    .gte('created_at', tenMinAgo)
    .limit(1)
  if (dup && dup.length > 0) return { ok: false, error: '방금 같은 안내를 보냈습니다. 10분 후 다시 시도해 주세요.', status: 429 }

  // 담당자 이름 (없으면 회사명만)
  let staffName = ''
  const { data: staff } = await admin.from('profiles').select('name').eq('id', schedule.staff_id).maybeSingle()
  staffName = String((staff as { name?: string } | null)?.name ?? '')

  const variables: Record<string, string> = {
    '#{고객명}': customer.name,
    '#{담당자명}': staffName || 'SJ INVEST',
    '#{일시}': formatKst(schedule.starts_at),
    '#{장소}': schedule.location ?? '추후 안내',
    '#{미팅유형}': TYPE_LABEL[schedule.type] ?? '미팅'
  }

  const sendRes = await solapiSend({ to: phone, templateId, variables })

  await admin.from('alimtalk_logs').insert({
    schedule_id: schedule.id,
    customer_id: customer.id,
    staff_id: schedule.staff_id,
    sent_by: sentBy,
    kind,
    phone_masked: maskPhone(phone),
    status: sendRes.ok ? 'success' : 'failed',
    provider_message_id: sendRes.providerId ?? null,
    error: sendRes.ok ? null : (sendRes.error ?? null)
  })

  if (!sendRes.ok) return { ok: false, error: sendRes.error ?? '발송에 실패했습니다.' }
  return { ok: true }
}
