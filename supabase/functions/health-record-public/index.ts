// SJ INVEST — 건강기록 '고객 입력' 공개 엣지 (health-record-public)
//
// 고객이 링크(?hr=1&r=<id>&t=<token>)에서 본인 주민번호를 입력하고 간편인증을 승인한다.
// 로그인 없이(anon) 호출되며, 토큰(해시)·만료 검증 후 service_role 로 해당 요청 row 만 갱신한다.
//
// mode:
//  - 'info'    : { r, t } → 표시용 컨텍스트(고객명·식별필드) 반환(민감정보 없음)
//  - 'start'   : { r, t, rrn, loginTypeLevel, telecom? } → CODEF 간편인증 시작(2-way)
//  - 'confirm' : { r, t, rrn, loginTypeLevel, telecom? } → 고객 승인 후 결과 조회
//
// 보안: 토큰 sha256(`${r}:${token}`) 일치 + 미만료 + 상태검증. 완료 전까지는 재시도 허용(주민번호
//       오타 대비), 완료되면 잠금. start 시도 횟수는 상한(MAX_START_ATTEMPTS)으로 제한.
//       주민번호(identity)와 결과(result)는 로그에 남기지 않는다. CODEF 로직은 health-record-fetch 와 동일.
// Secrets: CODEF_CLIENT_ID/SECRET/PUBLIC_KEY, (선택)CODEF_HEALTH_PRODUCT_URL. SUPABASE_* 자동.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
const envAny = (...names: string[]): string => {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  return ''
}
const normalizePublicKey = (k: string): string => {
  const b64 = k.replace(/[^A-Za-z0-9+/=]/g, '')
  return b64.replace(/.{64}/g, '$&\n').replace(/\n$/, '')
}
const DEFAULT_HEALTH_PRODUCT_URL = '/v1/kr/public/pp/nhis-list/medical-history'
const MAX_START_ATTEMPTS = 10 // 주민번호 오타 등 재시도 허용 상한(만료 전까지)

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function classify(res: unknown): { kind: 'ok' | 'twoway' | 'error'; code: string; message: string; data: Record<string, unknown> } {
  let obj: unknown = res
  if (typeof res === 'string') {
    try {
      obj = JSON.parse(res)
    } catch {
      obj = {}
    }
  }
  const r = (obj ?? {}) as { result?: { code?: string; message?: string }; data?: Record<string, unknown> }
  const code = r.result?.code ?? ''
  const message = r.result?.message ?? ''
  const data = (r.data ?? {}) as Record<string, unknown>
  if (code === 'CF-00000') return { kind: 'ok', code, message, data }
  if (data.continue2Way === true || code === 'CF-03002') return { kind: 'twoway', code, message, data }
  return { kind: 'error', code, message, data }
}

interface Row {
  id: string
  customer_name: string | null
  product: string | null
  status: string
  request_meta: Record<string, unknown> | null
  two_way: Record<string, unknown> | null
  link_token_hash: string | null
  link_expires_at: string | null
  link_used_at: string | null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST 요청만 지원합니다.' }, 405)

  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!su || !serviceKey) return json({ ok: false, error: '서버 설정 오류.' }, 500)
  const admin = createClient(su, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: { mode?: string; r?: string; t?: string; rrn?: string; loginTypeLevel?: string; telecom?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const mode = String(body.mode ?? 'info')
  const id = String(body.r ?? '')
  const token = String(body.t ?? '')
  if (!id || !token) return json({ ok: false, error: '유효하지 않은 링크입니다.' }, 400)

  // 토큰·만료·존재 검증(일반 오류 — 열거 방지)
  const { data } = await admin
    .from('health_record_requests')
    .select('id, customer_name, product, status, request_meta, two_way, link_token_hash, link_expires_at, link_used_at')
    .eq('id', id)
    .maybeSingle()
  const row = data as Row | null
  const INVALID = json({ ok: false, code: 'LINK_INVALID', error: '링크가 유효하지 않거나 만료되었습니다. 담당 설계사에게 문의해 주세요.' }, 400)
  if (!row || !row.link_token_hash) return INVALID
  if (!row.link_expires_at || new Date(row.link_expires_at).getTime() < Date.now()) return INVALID
  if ((await sha256Hex(`${id}:${token}`)) !== row.link_token_hash) return INVALID

  const meta = (row.request_meta ?? {}) as { paramTemplate?: Record<string, unknown>; encryptFields?: string[]; idField?: string; idLen?: number }

  if (mode === 'info') {
    return json({
      ok: true,
      customerName: row.customer_name ?? '',
      idField: meta.idField ?? 'rrn',
      idLen: meta.idLen ?? 13,
      status: row.status
    })
  }

  // start/confirm — CODEF 설정 확인
  const clientId = envAny('CODEF_CLIENT_ID', 'client_id').trim()
  const clientSecret = envAny('CODEF_CLIENT_SECRET', 'client_secret').trim()
  const publicKey = normalizePublicKey(envAny('CODEF_PUBLIC_KEY', 'public_key'))
  if (!clientId || !clientSecret || !publicKey) {
    return json({ ok: false, code: 'CODEF_NOT_CONFIGURED', error: '건강보험 조회 설정이 아직 완료되지 않았습니다. 담당 설계사에게 문의해 주세요.' }, 503)
  }
  const rrn = String(body.rrn ?? '').replace(/\D/g, '')
  if (!rrn) return json({ ok: false, error: '본인확인 번호를 입력해 주세요.' }, 400)
  // 완료된 링크만 잠근다. 그 외 상태(awaiting_customer/awaiting_auth/failed)는 만료(30분) 전까지
  // 재시도를 허용 — 주민번호 오타·일시 오류로 링크가 영구 잠기지 않도록.
  if (row.status === 'completed') return json({ ok: false, code: 'DONE', error: '이미 조회가 완료된 링크입니다.' }, 409)
  const attempts = Number((meta as { attempts?: number }).attempts ?? 0)
  if (mode === 'start' && attempts >= MAX_START_ATTEMPTS) {
    return json({ ok: false, code: 'TOO_MANY', error: '시도 횟수가 많습니다. 담당 설계사에게 새 링크를 요청해 주세요.' }, 429)
  }
  if (mode === 'confirm' && row.status !== 'awaiting_auth') return json({ ok: false, error: '먼저 조회를 시작해 주세요.' }, 409)

  const template = (meta.paramTemplate ?? {}) as Record<string, unknown>
  const productUrl = (row.product && row.product.startsWith('/') ? row.product : '') || envAny('CODEF_HEALTH_PRODUCT_URL') || DEFAULT_HEALTH_PRODUCT_URL

  try {
    const { EasyCodef, EasyCodefConstant, EasyCodefUtil } = await import('npm:easycodef-node@1')
    const codef = new EasyCodef()
    codef.setPublicKey(publicKey)
    codef.setClientInfoForDemo(clientId, clientSecret)

    const param: Record<string, unknown> = { ...template, identity: rrn }
    if (body.loginTypeLevel) param.loginTypeLevel = String(body.loginTypeLevel)
    if (body.telecom) param.telecom = String(body.telecom)
    for (const f of meta.encryptFields ?? []) {
      if (typeof param[f] === 'string' && param[f]) param[f] = EasyCodefUtil.encryptRSA(publicKey, String(param[f]))
    }
    if (mode === 'confirm' && row.two_way) {
      param.is2Way = true
      param.twoWayInfo = row.two_way
      param.simpleAuth = '1'
    }

    const res = await codef.requestProduct(productUrl, EasyCodefConstant.SERVICE_TYPE_DEMO, param)
    const out = classify(res)
    console.log('[hr-public] codef', { kind: out.kind, code: out.code, mode })

    const patch = async (p: Record<string, unknown>): Promise<void> => {
      await admin.from('health_record_requests').update(p).eq('id', id)
    }
    const bumpedMeta = { ...meta, attempts: attempts + 1 } // start 시도 횟수 누적(재시도 상한용)

    if (out.kind === 'twoway') {
      const twoWay = { jobIndex: out.data.jobIndex, threadIndex: out.data.threadIndex, jti: out.data.jti, twoWayTimestamp: out.data.twoWayTimestamp }
      await patch({ status: 'awaiting_auth', two_way: twoWay, link_used_at: new Date().toISOString(), ...(mode === 'start' ? { request_meta: bumpedMeta } : {}) })
      return json({ ok: true, status: 'awaiting_auth', message: '휴대폰에서 간편인증을 승인해 주세요.' })
    }
    if (out.kind === 'ok') {
      await patch({ status: 'completed', consent_at: new Date().toISOString(), result: out.data, two_way: null, error: null, link_used_at: new Date().toISOString() })
      return json({ ok: true, status: 'completed' })
    }
    // 아직 승인 전(confirm 폴링)이면 계속 대기.
    const deadSession = out.code === 'CF-00025'
    if (mode === 'confirm' && !deadSession) {
      return json({ ok: false, status: 'awaiting_auth', pending: true, error: out.message || '아직 승인 전입니다.' })
    }
    if (mode === 'start') {
      // 주민번호 오타·입력 오류 등 — 링크를 잠그지 않고 다시 입력할 수 있게 둔다(만료 전까지).
      await patch({ status: 'awaiting_customer', two_way: null, error: `${out.code} ${out.message}`.trim(), request_meta: bumpedMeta })
      const looksIdentity = /주민|등록번호|생년월일|identity|불일치|일치하지|확인|CF-0013|CF-00014|CF-04/.test(`${out.code} ${out.message}`)
      return json({
        ok: false,
        status: 'retry',
        code: out.code,
        error: looksIdentity
          ? '입력하신 정보가 올바르지 않습니다. 주민등록번호(또는 생년월일)를 다시 확인해 입력해 주세요.'
          : (out.message || '조회에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      })
    }
    // confirm 단계의 종료 실패(세션 만료 등)
    await patch({ status: 'failed', error: `${out.code} ${out.message}`.trim() })
    return json({ ok: false, status: 'failed', code: out.code, error: out.message || '조회에 실패했습니다.' })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.' }, 500)
  }
})
