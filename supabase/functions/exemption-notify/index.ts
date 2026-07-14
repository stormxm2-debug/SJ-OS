// SJ INVEST — 면책 종료(보장 시작) 고객 알림톡 (exemption-notify)
//
// 개별 발송(앱 버튼): POST { exemptionId }
//   - 로그인 사용자만. 본인 담당 면책 기록 또는 owner/admin만 발송 가능.
// 배치 자동 발송(pg_cron): POST { mode: 'notify-due' } + Bearer = service_role
//   - 오늘(KST) 기준 면책이 도래(kind='due')했고 아직 고객 미발송인 알림 건을
//     찾아 고객에게 "보장 시작" 알림톡을 일괄 발송하고 customer_notified 표시.
//
// 전화번호는 서버에서만 조회한다. 솔라피 시크릿(send-alimtalk과 공유):
//   SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_PF_ID / SOLAPI_SENDER_PHONE
//   SOLAPI_TPL_EXEMPTION_DUE   보장 시작 안내 템플릿 ID (카카오 심사 필요)
// 시크릿 없으면 503 ALIMTALK_NOT_CONFIGURED — 앱은 무료 '카톡 공유'로 안내.
// 배치용 customer_notified 칼럼은 SJ_OS_SUPABASE_EXEMPTION_NOTIFY.sql 적용 필요.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** "7월 15일(화)" (KST). */
function formatKstDate(dateStr: string): string {
  const d = new Date(Date.parse(dateStr))
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(d)
}

/** 솔라피 HMAC-SHA256 인증 헤더 (send-alimtalk과 동일 방식). */
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

async function solapiSend(to: string, templateId: string, variables: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  const pfId = Deno.env.get('SOLAPI_PF_ID') ?? ''
  const from = (Deno.env.get('SOLAPI_SENDER_PHONE') ?? '').replace(/\D/g, '')
  const auth = await solapiAuthHeader(apiKey, apiSecret)
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({
      message: { to, from, kakaoOptions: { pfId, templateId, variables, disableSms: false } }
    })
  })
  const data = (await res.json().catch(() => ({}))) as { errorMessage?: string; message?: string }
  if (!res.ok) return { ok: false, error: data.errorMessage || data.message || `솔라피 오류 (HTTP ${res.status})` }
  return { ok: true }
}

interface ExemptionRow {
  id: string
  staff_id: string
  customer_id: string
  insurer: string
  product_name: string | null
  coverage: string | null
  waiting_end: string
  customer: { id: string; name: string; phone: string | null } | null
}

const EXEMPTION_COLS = 'id, staff_id, customer_id, insurer, product_name, coverage, waiting_end, customer:customers(id, name, phone)'

/** 고객 1명에게 보장 시작 알림톡 발송. */
async function sendOne(row: ExemptionRow): Promise<{ ok: boolean; error?: string; status?: number }> {
  const phone = (row.customer?.phone ?? '').replace(/\D/g, '')
  if (!row.customer || !phone) return { ok: false, error: '고객 연락처가 없습니다. 고객 정보에 전화번호를 먼저 입력해 주세요.', status: 400 }
  const templateId = Deno.env.get('SOLAPI_TPL_EXEMPTION_DUE') ?? ''
  if (!templateId) return { ok: false, error: '보장 시작 안내 템플릿 ID(SOLAPI_TPL_EXEMPTION_DUE)가 등록되지 않았습니다.', status: 503 }
  const variables: Record<string, string> = {
    '#{고객명}': row.customer.name,
    '#{보험사}': row.insurer,
    '#{담보}': row.coverage || row.product_name || '가입 담보',
    '#{개시일}': formatKstDate(row.waiting_end)
  }
  return await solapiSend(phone, templateId, variables)
}

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

  let body: { exemptionId?: unknown; mode?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  // ---------- 배치: 오늘 면책 도래 건 고객 자동 발송 (pg_cron → service_role) ----------
  if (String(body.mode ?? '') === 'notify-due') {
    if (bearer !== serviceKey) return json({ success: false, error: '권한이 없습니다.' }, 403)
    // 오늘(KST) 생성된 도래 알림 중 고객 미발송 건
    const { data: alerts, error: aErr } = await admin
      .from('exemption_alerts')
      .select('id, exemption_id')
      .eq('kind', 'due')
      .eq('customer_notified', false)
    if (aErr) {
      // customer_notified 칼럼 미적용(SQL 인계 전)이면 여기로 온다 — 명확히 알린다.
      return json({ success: false, error: `알림 조회 실패: ${aErr.message} (EXEMPTION_NOTIFY SQL 적용 필요)` }, 500)
    }
    let sent = 0
    let skipped = 0
    for (const a of (alerts ?? []) as { id: string; exemption_id: string }[]) {
      const { data: row } = await admin.from('policy_exemptions').select(EXEMPTION_COLS).eq('id', a.exemption_id).maybeSingle()
      if (!row) {
        skipped += 1
        continue
      }
      const r = await sendOne(row as unknown as ExemptionRow)
      if (r.ok) {
        sent += 1
        await admin.from('exemption_alerts').update({ customer_notified: true }).eq('id', a.id)
      } else {
        skipped += 1
      }
    }
    return json({ success: true, sent, skipped })
  }

  // ---------- 개별 발송 (앱 버튼) ----------
  const exemptionId = String(body.exemptionId ?? '').trim()
  if (!exemptionId) return json({ success: false, error: 'exemptionId가 필요합니다.' }, 400)

  const caller = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const { data: userData } = await caller.auth.getUser()
  const callerId = userData?.user?.id
  if (!callerId) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  const { data: row, error: rowErr } = await admin.from('policy_exemptions').select(EXEMPTION_COLS).eq('id', exemptionId).maybeSingle()
  if (rowErr || !row) return json({ success: false, error: '면책 기록을 찾을 수 없습니다.' }, 404)
  const exemption = row as unknown as ExemptionRow

  if (exemption.staff_id !== callerId) {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
    const role = String((prof as { role?: string } | null)?.role ?? '')
    if (role !== 'owner' && role !== 'admin') return json({ success: false, error: '본인 담당 건만 발송할 수 있습니다.' }, 403)
  }

  const result = await sendOne(exemption)
  if (!result.ok) return json({ success: false, error: result.error }, result.status ?? 502)
  return json({ success: true })
})
