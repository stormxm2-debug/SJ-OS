import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'

/**
 * AI 보장분석 (insurance-analysis edge function) 클라이언트.
 *
 * 고객 증권(사진/PDF)을 이 기기에서 압축·base64 인코딩해 서버로 보내면, Claude가
 * 담보를 읽어 카테고리별 보장현황·공백·적정성 + 보완 제안을 돌려준다. 청구비서와
 * 별개(그건 보험금 계산, 이건 영업용 보장 갭 분석). 증권은 저장되지 않으며, 결과는
 * 사용자가 고객을 선택했을 때만 insurance_analyses(RLS)로 저장한다.
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type Adequacy = 'sufficient' | 'partial' | 'insufficient' | 'none'
export type GapSeverity = 'high' | 'medium' | 'low'

export interface AnalysisProfile {
  age?: number
  gender?: '남' | '여' | ''
  job?: string
  medicalHistory?: string
}

export interface CoverageCategory {
  category: string
  current: string
  adequacy: Adequacy
  note: string
}

export interface CoverageGap {
  title: string
  severity: GapSeverity
  why: string
  suggestion: string
}

export interface PolicyInfo {
  insurer: string
  product?: string
  monthlyPremium?: number | null
}

export interface InsuranceAnalysisResult {
  summary: string
  policies: PolicyInfo[]
  categories: CoverageCategory[]
  gaps: CoverageGap[]
  recommendation: string
  customerMessage: string
  cautions: string[]
}

export interface SavedInsuranceAnalysis {
  id: string
  customerId: string | null
  createdAt: string
  result: InsuranceAnalysisResult
}

// ── 파일 준비 (압축 + base64, 전부 클라이언트) ───────────────────────────────

interface PreparedDoc {
  name: string
  mediaType: string
  data: string
}

const IMG_MAX_DIM = 2200
const IMG_QUALITY = 0.82
const COMPRESS_SKIP_BYTES = 500 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_IMAGE_B64_CHARS = 9_500_000

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(new Error('file-read'))
    r.readAsDataURL(blob)
  })
}

async function reencodeToJpeg(file: File): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file)
    try {
      const scale = Math.min(1, IMG_MAX_DIM / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * scale))
      const h = Math.max(1, Math.round(bmp.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bmp, 0, 0, w, h)
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMG_QUALITY))
    } finally {
      bmp.close()
    }
  } catch {
    return null
  }
}

/** 증권 한 장 준비: 큰 이미지는 축소, 비지원 형식은 JPEG 변환, PDF는 원본. */
async function prepareFile(file: File): Promise<{ ok: true; doc: PreparedDoc } | { ok: false; error: string }> {
  if (file.type === 'application/pdf') {
    const data = await blobToBase64(file)
    if (!data) return { ok: false, error: `"${file.name}" 파일이 비어 있습니다.` }
    return { ok: true, doc: { name: file.name, mediaType: 'application/pdf', data } }
  }
  const isSupported = SUPPORTED_IMAGE_TYPES.has(file.type)
  let blob: Blob = file
  let mediaType = file.type
  if (!isSupported || file.size > COMPRESS_SKIP_BYTES) {
    const jpeg = await reencodeToJpeg(file)
    if (jpeg && (!isSupported || jpeg.size < file.size)) {
      blob = jpeg
      mediaType = 'image/jpeg'
    } else if (!isSupported) {
      return { ok: false, error: `"${file.name}" 사진 형식을 지원하지 않습니다. JPG로 저장해 다시 올려주세요.` }
    }
  }
  const data = await blobToBase64(blob)
  if (!data) return { ok: false, error: `"${file.name}" 파일이 비어 있습니다.` }
  if (data.length > MAX_IMAGE_B64_CHARS) {
    return { ok: false, error: `"${file.name}" 사진이 압축 후에도 너무 큽니다. 증권 부분만 잘라 다시 촬영해 올려주세요.` }
  }
  return { ok: true, doc: { name: file.name, mediaType, data } }
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

const ADEQ: Adequacy[] = ['sufficient', 'partial', 'insufficient', 'none']
const SEV: GapSeverity[] = ['high', 'medium', 'low']

function normalize(raw: Record<string, unknown>): InsuranceAnalysisResult {
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.]/g, ''))
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null
    }
    return null
  }
  return {
    summary: String(raw.summary ?? ''),
    policies: (Array.isArray(raw.policies) ? raw.policies : []).map((p) => {
      const o = p as Record<string, unknown>
      return { insurer: String(o.insurer ?? ''), product: o.product ? String(o.product) : undefined, monthlyPremium: num(o.monthlyPremium) }
    }),
    categories: (Array.isArray(raw.categories) ? raw.categories : [])
      .map((c) => {
        const o = c as Record<string, unknown>
        return {
          category: String(o.category ?? ''),
          current: String(o.current ?? ''),
          adequacy: ADEQ.includes(o.adequacy as Adequacy) ? (o.adequacy as Adequacy) : 'none',
          note: String(o.note ?? '')
        }
      })
      .filter((c) => c.category),
    gaps: (Array.isArray(raw.gaps) ? raw.gaps : [])
      .map((g) => {
        const o = g as Record<string, unknown>
        return {
          title: String(o.title ?? ''),
          severity: SEV.includes(o.severity as GapSeverity) ? (o.severity as GapSeverity) : 'medium',
          why: String(o.why ?? ''),
          suggestion: String(o.suggestion ?? '')
        }
      })
      .filter((g) => g.title),
    recommendation: String(raw.recommendation ?? ''),
    customerMessage: String(raw.customerMessage ?? ''),
    cautions: strList(raw.cautions)
  }
}

/** 증권 업로드 → AI 보장분석. 1분 내외 소요. */
export async function analyzeCoverage(
  files: File[],
  profile: AnalysisProfile,
  extraNotes = ''
): Promise<{ ok: boolean; result?: InsuranceAnalysisResult; error?: string; disabled?: boolean }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const list = files.filter(Boolean).slice(0, 6)
  if (list.length === 0) return { ok: false, error: '분석할 증권을 먼저 올려주세요.' }

  const docs: PreparedDoc[] = []
  for (const f of list) {
    const res = await prepareFile(f)
    if (!res.ok) return { ok: false, error: res.error }
    docs.push(res.doc)
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 150000)
  try {
    const token = (await bearer()) ?? anon
    const res = await fetch(`${base}/insurance-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'analyze', files: docs, profile, extraNotes }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !data?.success) {
      const disabled = data?.code === 'ANTHROPIC_API_KEY_MISSING' || res.status === 404
      return { ok: false, error: String(data?.error ?? `분석 요청 실패 (HTTP ${res.status})`), disabled }
    }
    const raw = data.result as Record<string, unknown> | undefined
    if (!raw) return { ok: false, error: '보장분석 결과가 비어 있습니다. 다시 시도해 주세요.' }
    return { ok: true, result: normalize(raw) }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '분석 시간이 초과되었습니다. 증권 수를 줄여 다시 시도해 주세요.' : '서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

// ── 저장/조회 (insurance_analyses) ───────────────────────────────────────────

type Db = {
  auth: { getUser: () => Promise<{ data?: { user?: { id?: string } } }> }
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } }
    select: (c: string) => {
      eq: (k: string, v: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> } }
    }
  }
}

/** 고객이 선택된 보장분석 결과를 고객 기록(insurance_analyses)에 저장. */
export async function saveInsuranceAnalysis(customerId: string, result: InsuranceAnalysisResult): Promise<{ ok: boolean; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db | null
    if (!db) return { ok: false, error: '서버 연결 후 저장할 수 있습니다.' }
    const { data: u } = await db.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return { ok: false, error: '로그인 후 저장할 수 있습니다.' }
    const { error } = await db.from('insurance_analyses').insert({ customer_id: customerId, staff_id: uid, result }).select('id').single()
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }
}

/** 특정 고객의 지난 보장분석 목록 (최신순 10건). */
export async function listInsuranceAnalyses(customerId: string): Promise<{ ok: boolean; items: SavedInsuranceAnalysis[]; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db | null
    if (!db) return { ok: false, items: [] }
    const { data, error } = await db.from('insurance_analyses').select('id, customer_id, created_at, result').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10)
    if (error) return { ok: false, items: [], error: error.message }
    const rows = (data as { id: string; customer_id: string | null; created_at: string; result: unknown }[]) ?? []
    return {
      ok: true,
      items: rows.map((r) => ({ id: r.id, customerId: r.customer_id, createdAt: r.created_at, result: r.result as InsuranceAnalysisResult }))
    }
  } catch {
    return { ok: false, items: [] }
  }
}
