import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import {
  listUnderwriting as listGuideRules,
  UNDERWRITING_STATUS_LABEL
} from '@renderer/services/underwriting/underwritingService'

/**
 * AI 사전심사 언더라이터 (underwriting-expert edge function) 클라이언트.
 *
 * 고객 프로필 + 계약전 알릴의무(고지) 문답을 서버로 보내 예상 인수 결과를 받는다.
 * '예외질병 인수 가이드'(underwriting_diseases/rules)의 사내 기준 중 고객 병력과
 * 매칭되는 항목을 함께 보내 AI 판단의 최우선 근거로 쓴다 (읽기 전용 연동).
 * Anthropic 키는 서버 시크릿에만 존재. 병력 등 민감정보는 절대 로깅하지 않으며,
 * 저장은 고객을 선택한 분석에 한해 underwriting_analyses(RLS)로만 한다.
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface UnderwritingProfile {
  age: number
  gender: '남' | '여' | ''
  heightCm?: number
  weightKg?: number
  bmi?: number | null
  job?: string
  smoking?: string
  drinking?: string
}

export interface DisclosureAnswer {
  has: boolean
  detail: string
}

export interface DisclosureAnswers {
  /** 3개월 내 진찰·검사 소견 또는 투약. */
  m3: DisclosureAnswer
  /** 1년 내 추가검사(재검사). */
  y1: DisclosureAnswer
  /** 5년 내 입원·수술·7일 이상 치료·30일 이상 투약. */
  y5: DisclosureAnswer
  /** 5년 내 중대질병(암·고혈압·당뇨 등) 진단·치료. */
  major: DisclosureAnswer
}

export interface UnderwritingAiInput {
  profile: UnderwritingProfile
  disclosures: DisclosureAnswers
  medicalHistory: string
  targetAreas: string[]
  extraNotes: string
}

/** 사내 인수기준 분류표에서 매칭된 한 줄 (엣지 함수 전달용). */
export interface KnownRule {
  disease: string
  insurer: string
  status: string
  note: string
  verified: boolean
}

export type UnderwritingGrade = 'standard' | 'likely' | 'conditional' | 'difficult' | 'info-needed'
export type AreaVerdict = '가능' | '조건부' | '어려움' | '정보필요'

export interface AreaAssessment {
  area: string
  verdict: AreaVerdict
  condition: string | null
  reason: string
}

export interface UnderwritingAiResult {
  overallGrade: UnderwritingGrade
  headline: string
  summary: string
  byArea: AreaAssessment[]
  keyFactors: { factor: string; impact: 'high' | 'medium' | 'low'; note: string }[]
  disclosureGuide: string[]
  alternatives: { name: string; why: string; note: string }[]
  neededInfo: string[]
  customerMessage: string
  cautions: string[]
}

export interface SavedUnderwritingAi {
  id: string
  customerId: string | null
  createdAt: string
  input: UnderwritingAiInput
  result: UnderwritingAiResult
}

// ── 엣지 함수 호출 ────────────────────────────────────────────────────────────

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

async function postJson(body: unknown, timeoutMs: number): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; disabled?: boolean }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = (await bearer()) ?? anon
    const res = await fetch(`${base}/underwriting-expert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !data?.success) {
      const disabled = data?.code === 'ANTHROPIC_API_KEY_MISSING' || res.status === 404
      return { ok: false, error: String(data?.error ?? `심사 요청 실패 (HTTP ${res.status})`), disabled }
    }
    return { ok: true, data }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '심사 분석 시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

const VERDICTS: AreaVerdict[] = ['가능', '조건부', '어려움', '정보필요']
const GRADES: UnderwritingGrade[] = ['standard', 'likely', 'conditional', 'difficult', 'info-needed']

/** 서버(모델) 응답을 안전한 형태로 정규화 — 누락 필드는 빈 값, 이상 enum은 보수적 기본값. */
function normalizeResult(raw: Record<string, unknown>): UnderwritingAiResult {
  const grade = GRADES.includes(raw.overallGrade as UnderwritingGrade) ? (raw.overallGrade as UnderwritingGrade) : 'info-needed'
  const byArea = (Array.isArray(raw.byArea) ? raw.byArea : [])
    .map((a) => {
      const r = a as Record<string, unknown>
      return {
        area: String(r.area ?? ''),
        verdict: VERDICTS.includes(r.verdict as AreaVerdict) ? (r.verdict as AreaVerdict) : ('정보필요' as AreaVerdict),
        condition: r.condition ? String(r.condition) : null,
        reason: String(r.reason ?? '')
      }
    })
    .filter((a) => a.area)
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])
  return {
    overallGrade: grade,
    headline: String(raw.headline ?? ''),
    summary: String(raw.summary ?? ''),
    byArea,
    keyFactors: (Array.isArray(raw.keyFactors) ? raw.keyFactors : []).map((f) => {
      const r = f as Record<string, unknown>
      const impact = r.impact === 'high' || r.impact === 'medium' || r.impact === 'low' ? r.impact : 'medium'
      return { factor: String(r.factor ?? ''), impact, note: String(r.note ?? '') }
    }),
    disclosureGuide: strList(raw.disclosureGuide),
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : []).map((a) => {
      const r = a as Record<string, unknown>
      return { name: String(r.name ?? ''), why: String(r.why ?? ''), note: String(r.note ?? '') }
    }),
    neededInfo: strList(raw.neededInfo),
    customerMessage: String(raw.customerMessage ?? ''),
    cautions: strList(raw.cautions)
  }
}

/** 사전심사 실행 — Opus 정밀 판단으로 30초~2분 소요될 수 있다. */
export async function assessUnderwriting(
  input: UnderwritingAiInput,
  knownRules: KnownRule[] = []
): Promise<{ ok: boolean; result?: UnderwritingAiResult; error?: string; disabled?: boolean }> {
  const res = await postJson({ mode: 'assess', ...input, knownRules }, 150000)
  if (!res.ok) return { ok: false, error: res.error, disabled: res.disabled }
  const raw = res.data?.result as Record<string, unknown> | undefined
  if (!raw) return { ok: false, error: '심사 결과가 비어 있습니다. 다시 시도해 주세요.' }
  return { ok: true, result: normalizeResult(raw) }
}

// ── 사내 인수기준 분류표 연동 (읽기 전용) ────────────────────────────────────

/**
 * 예외질병 인수 가이드에서 고객 병력 텍스트와 매칭되는 기준만 추린다.
 * 분류표가 아직 없거나(스키마 미적용) 비어 있으면 조용히 빈 배열 — AI 심사는
 * 일반 인수 관행만으로 진행된다.
 */
export async function collectKnownRules(freeText: string): Promise<KnownRule[]> {
  const text = freeText.trim()
  if (text.length < 2) return []
  try {
    const res = await listGuideRules()
    if (!res.ok || res.items.length === 0) return []
    const out: KnownRule[] = []
    for (const disease of res.items) {
      const names = [disease.name, ...disease.aliases].map((n) => n.trim()).filter((n) => n.length >= 2)
      if (!names.some((n) => text.includes(n))) continue
      for (const rule of Object.values(disease.rules)) {
        if (rule.status === 'unknown') continue
        out.push({
          disease: disease.name,
          insurer: rule.insurer,
          status: UNDERWRITING_STATUS_LABEL[rule.status],
          note: rule.note ?? '',
          verified: rule.verified
        })
        if (out.length >= 60) return out
      }
    }
    return out
  } catch {
    return []
  }
}

// ── 저장/조회 (underwriting_analyses) ────────────────────────────────────────

type Db = {
  auth: { getUser: () => Promise<{ data?: { user?: { id?: string } } }> }
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } }
    select: (c: string) => {
      eq: (k: string, v: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> } }
    }
  }
}

/** 고객이 선택된 심사 결과를 고객 기록(underwriting_analyses)에 저장. */
export async function saveUnderwritingAi(customerId: string, input: UnderwritingAiInput, result: UnderwritingAiResult): Promise<{ ok: boolean; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db | null
    if (!db) return { ok: false, error: '서버 연결 후 저장할 수 있습니다.' }
    const { data: u } = await db.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return { ok: false, error: '로그인 후 저장할 수 있습니다.' }
    const { error } = await db.from('underwriting_analyses').insert({ customer_id: customerId, staff_id: uid, input, result }).select('id').single()
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }
}

/** 특정 고객의 지난 사전심사 목록 (최신순 10건). */
export async function listUnderwritingAi(customerId: string): Promise<{ ok: boolean; items: SavedUnderwritingAi[]; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db | null
    if (!db) return { ok: false, items: [] }
    const { data, error } = await db.from('underwriting_analyses').select('id, customer_id, created_at, input, result').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10)
    if (error) return { ok: false, items: [], error: error.message }
    const rows = (data as { id: string; customer_id: string | null; created_at: string; input: unknown; result: unknown }[]) ?? []
    return {
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        createdAt: r.created_at,
        input: r.input as UnderwritingAiInput,
        result: r.result as UnderwritingAiResult
      }))
    }
  } catch {
    return { ok: false, items: [] }
  }
}
