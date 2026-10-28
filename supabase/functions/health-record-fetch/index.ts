// SJ INVEST — 고객 건강기록(공단·심평원) 조회 (CODEF 간편인증)
//
// 흐름: FC가 요청 생성 → 고객이 간편인증(카카오/PASS) 승인 → 그 결과(진료/검진 내역)를 받아 확인.
// CODEF 공식 SDK(easycodef-node)로 토큰·RSA 암호화·2-way(추가인증)를 처리한다.
//
// 절대 규칙:
//  - CODEF 키(clientId/secret)·공개키는 서버 시크릿에만 둔다(코드/프론트에 넣지 않음).
//  - 상품 URL·요청변수는 추측하지 않는다 — CODEF 콘솔 스펙을 환경변수/요청으로 받아 그대로 쓴다.
//  - 민감 의료정보(result)는 로깅하지 않으며, 저장은 health_record_requests(RLS)로만 한다.
//
// 필요한 시크릿(Supabase Edge Function secrets):
//  CODEF_CLIENT_ID, CODEF_CLIENT_SECRET, CODEF_PUBLIC_KEY   (데모/정식 중 쓰는 것)
//  CODEF_HEALTH_PRODUCT_URL  (예: /v1/kr/public/..  — CODEF 콘솔의 진료받은내용/건강검진 상품 URL)
//  (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY 는 기본 제공)

import { createClient } from 'jsr:@supabase/supabase-js@2'
// CODEF 공식 SDK(easycodef-node)는 실제 호출 시점에만 동적 로드한다 — 설정 전/부팅 시
// npm 로드 실패로 함수가 죽지 않게. (Deno npm: 지원)

// 시크릿 이름을 대소문자 둘 다 허용한다 — 콘솔에서 소문자(client_id 등)로 넣어도 읽히도록.
const envAny = (...names: string[]): string => {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  return ''
}

// CODEF 「진료받은 내용」(건강보험공단) 상품 경로 — 데모/정식 공통(앞 도메인은 SDK가 서비스타입으로 결정).
// 출처: developer.codef.io 엔드포인트. 데모 https://development.codef.io + 이 경로 / 정식 https://api.codef.io + 이 경로.
// 시크릿(CODEF_HEALTH_PRODUCT_URL)이나 요청(body.product)로 덮어쓸 수 있고, 없으면 이 기본값을 쓴다.
const DEFAULT_HEALTH_PRODUCT_URL = '/v1/kr/public/pp/nhis-list/medical-history'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

interface Body {
  mode: 'start' | 'confirm'
  requestId?: string
  customerId?: string | null
  customerName?: string | null
  product?: string
  /** CODEF 요청 변수(조직코드·로그인구분·이름·전화·통신사·조회기간 등) — CODEF 상품 스펙대로. */
  param?: Record<string, unknown>
  /** 서버에서 RSA 암호화할 필드명(주민번호·비밀번호 등). */
  encryptFields?: string[]
  /** 2차(확인) 호출용 추가인증 정보. */
  twoWay?: { jobIndex: number; threadIndex: number; jti: string; twoWayTimestamp: number }
}

/** CODEF 응답을 안전하게 파싱 — 성공/추가인증필요/오류를 구분. */
function classify(res: unknown): { kind: 'ok' | 'twoway' | 'error'; code: string; message: string; data: Record<string, unknown> } {
  const r = (res ?? {}) as { result?: { code?: string; message?: string }; data?: Record<string, unknown> }
  const code = r.result?.code ?? ''
  const message = r.result?.message ?? ''
  const data = (r.data ?? {}) as Record<string, unknown>
  if (code === 'CF-00000') return { kind: 'ok', code, message, data }
  // 추가인증(간편인증 승인 대기) — CODEF 는 continue2Way=true + 2way 정보를 준다.
  if (data.continue2Way === true || code === 'CF-03002') return { kind: 'twoway', code, message, data }
  return { kind: 'error', code, message, data }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // 1) 호출자 인증 (로그인한 직원)
  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = su && anonKey && bearer
    ? createClient(su, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
    : null
  const uid = caller ? (await caller.auth.getUser()).data?.user?.id : null
  if (!uid || !caller) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  // 2) CODEF 설정 확인 (없으면 명확히 안내 — 추측 구현하지 않음)
  const clientId = envAny('CODEF_CLIENT_ID', 'client_id')
  const clientSecret = envAny('CODEF_CLIENT_SECRET', 'client_secret')
  const publicKey = envAny('CODEF_PUBLIC_KEY', 'public_key')
  if (!clientId || !clientSecret || !publicKey) {
    return json({ success: false, code: 'CODEF_NOT_CONFIGURED', error: 'CODEF 키(CODEF_CLIENT_ID/SECRET/PUBLIC_KEY) 시크릿이 설정되지 않았습니다.' }, 503)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const productUrl = (body.product && body.product.startsWith('/') ? body.product : '') || envAny('CODEF_HEALTH_PRODUCT_URL', 'health_product_url') || DEFAULT_HEALTH_PRODUCT_URL
  if (!productUrl) {
    return json(
      { success: false, code: 'CODEF_PRODUCT_URL_MISSING', error: 'CODEF 상품 URL이 없습니다. CODEF 콘솔의 「진료받은내용/건강검진」 상품 URL을 CODEF_HEALTH_PRODUCT_URL 시크릿에 넣어주세요.' },
      503
    )
  }

  // 3) CODEF 호출 — SDK는 이 시점에만 동적 로드(호환 이슈가 함수 부팅을 막지 않도록).
  try {
    const { EasyCodef, EasyCodefConstant, EasyCodefUtil } = await import('npm:easycodef-node@1')
    const codef = new EasyCodef()
    codef.setPublicKey(publicKey)
    codef.setClientInfoForDemo(clientId, clientSecret)

    // 요청 변수: 프론트가 준 param 사용(상품 스펙대로). 민감 필드는 서버에서 RSA 암호화.
    const param: Record<string, unknown> = { ...(body.param ?? {}) }
    for (const f of body.encryptFields ?? []) {
      if (typeof param[f] === 'string' && param[f]) param[f] = EasyCodefUtil.encryptRSA(publicKey, String(param[f]))
    }
    // 2차(확인) 호출이면 추가인증 정보를 실어 보낸다.
    if (body.mode === 'confirm' && body.twoWay) {
      param.is2Way = true
      param.twoWayInfo = body.twoWay
      param.simpleAuth = '1'
    }

    const res = await codef.requestProduct(productUrl, EasyCodefConstant.SERVICE_TYPE_DEMO, param)
    const out = classify(res)

    // 4) 상태/결과 저장 (health_record_requests, RLS: 본인/owner·admin)
    const persist = async (patch: Record<string, unknown>): Promise<string | null> => {
      try {
        if (body.requestId) {
          await caller.from('health_record_requests').update(patch).eq('id', body.requestId)
          return body.requestId
        }
        const ins = await caller
          .from('health_record_requests')
          .insert({ staff_id: uid, customer_id: body.customerId ?? null, customer_name: body.customerName ?? null, provider: 'codef', product: body.product ?? '', ...patch })
          .select('id')
          .single()
        return (ins.data as { id?: string } | null)?.id ?? null
      } catch {
        return body.requestId ?? null
      }
    }

    if (out.kind === 'twoway') {
      const twoWay = {
        jobIndex: out.data.jobIndex,
        threadIndex: out.data.threadIndex,
        jti: out.data.jti,
        twoWayTimestamp: out.data.twoWayTimestamp
      }
      const id = await persist({ status: 'awaiting_auth', two_way: twoWay })
      return json({ success: true, status: 'awaiting_auth', requestId: id, twoWay, message: out.message || '고객 휴대폰에서 간편인증을 승인해 주세요.' })
    }
    if (out.kind === 'ok') {
      const id = await persist({ status: 'completed', consent_at: new Date().toISOString(), result: out.data, two_way: null, error: null })
      return json({ success: true, status: 'completed', requestId: id, result: out.data })
    }
    const id = await persist({ status: 'failed', error: `${out.code} ${out.message}`.trim() })
    return json({ success: false, status: 'failed', requestId: id, code: out.code, error: out.message || '조회에 실패했습니다.' })
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : 'CODEF 호출 중 오류가 발생했습니다.' }, 500)
  }
})
