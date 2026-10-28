import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 고객 건강기록(공단·심평원) 조회 — health-record-fetch 엣지 함수 클라이언트.
 *
 * 흐름: start(간편인증 요청) → 고객이 휴대폰에서 승인 → confirm(결과 조회).
 * CODEF 키·상품 URL 은 서버 시크릿에만 있다. 민감 의료정보는 저장 시 RLS(health_record_requests)로만.
 */

export type HealthStatus = 'draft' | 'awaiting_auth' | 'consented' | 'fetching' | 'completed' | 'failed' | 'expired'

export interface TwoWayInfo {
  jobIndex: number
  threadIndex: number
  jti: string
  twoWayTimestamp: number
}

export interface HealthRecordRequest {
  id: string
  customerId: string | null
  customerName: string | null
  product: string
  status: HealthStatus
  createdAt: string
  result?: Record<string, unknown> | null
  error?: string | null
}

export interface StartInput {
  customerId?: string | null
  customerName?: string | null
  /** CODEF 상품 URL(선택) — 비우면 서버 기본값(CODEF_HEALTH_PRODUCT_URL) 사용. */
  product?: string
  /** CODEF 요청 변수(이름·전화·통신사·조회기간·주민번호 등) — 상품 스펙대로. */
  param: Record<string, unknown>
  /** 서버에서 RSA 암호화할 필드명(예: ['identity']). */
  encryptFields?: string[]
}

export interface StartResult {
  ok: boolean
  status?: HealthStatus
  requestId?: string
  twoWay?: TwoWayInfo
  result?: Record<string, unknown>
  message?: string
  error?: string
  code?: string
  disabled?: boolean
}

async function bearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

async function call(payload: Record<string, unknown>, timeoutMs = 150000): Promise<StartResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = (await bearer()) ?? anon
    const res = await fetch(`${base}/health-record-fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    // 엣지함수가 아직 배포되지 않았으면(404) 설정 안내로 처리.
    if (res.status === 404) {
      return { ok: false, disabled: true, code: 'CODEF_NOT_DEPLOYED', error: '건강기록 조회 서버(엣지함수)가 아직 배포되지 않았습니다. CODEF 키·상품 URL 준비 후 배포하면 동작합니다.' }
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!data) return { ok: false, error: `요청 실패 (HTTP ${res.status})` }
    const disabled = data.code === 'CODEF_NOT_CONFIGURED' || data.code === 'CODEF_PRODUCT_URL_MISSING' || res.status === 404
    return {
      ok: Boolean(data.success),
      status: data.status as HealthStatus | undefined,
      requestId: data.requestId as string | undefined,
      twoWay: data.twoWay as TwoWayInfo | undefined,
      result: data.result as Record<string, unknown> | undefined,
      message: data.message as string | undefined,
      error: data.error as string | undefined,
      code: data.code as string | undefined,
      disabled
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/** 1차: 간편인증 요청 (고객 휴대폰 승인 대기). */
export function startHealthRecord(input: StartInput): Promise<StartResult> {
  return call({ mode: 'start', ...input })
}

/** 2차: 고객 승인 후 결과 조회. (민감 필드는 encryptFields 로 서버에서 RSA 암호화) */
export function confirmHealthRecord(args: {
  requestId?: string
  product?: string
  param: Record<string, unknown>
  twoWay: TwoWayInfo
  encryptFields?: string[]
}): Promise<StartResult> {
  return call({ mode: 'confirm', ...args })
}

type Db = {
  from: (t: string) => {
    select: (c: string) => {
      order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> }
      eq: (k: string, v: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> } }
    }
  }
} | null

interface Row {
  id: string
  customer_id: string | null
  customer_name: string | null
  product: string
  status: HealthStatus
  created_at: string
  result: Record<string, unknown> | null
  error: string | null
}

const mapRow = (r: Row): HealthRecordRequest => ({
  id: r.id,
  customerId: r.customer_id,
  customerName: r.customer_name,
  product: r.product,
  status: r.status,
  createdAt: r.created_at,
  result: r.result,
  error: r.error
})

/** 최근 건강기록 요청 목록(최신순). customerId 를 주면 그 고객 것만. */
export async function listHealthRecords(customerId?: string): Promise<{ ok: boolean; items: HealthRecordRequest[]; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db
    if (!db) return { ok: false, items: [] }
    const cols = 'id, customer_id, customer_name, product, status, created_at, result, error'
    const q = db.from('health_record_requests').select(cols)
    const { data, error } = customerId
      ? await q.eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50)
      : await q.order('created_at', { ascending: false }).limit(50)
    if (error) return { ok: false, items: [], error: error.message }
    return { ok: true, items: ((data as Row[]) ?? []).map(mapRow) }
  } catch {
    return { ok: false, items: [] }
  }
}
