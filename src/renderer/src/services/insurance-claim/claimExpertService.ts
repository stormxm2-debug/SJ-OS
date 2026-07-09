import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'

/**
 * 보험금 청구 보상전문가 (claim-expert edge function) 클라이언트.
 *
 * 서류 수 무제한. 무거운 작업(이미지 압축 + base64 인코딩)은 전부 이 기기에서
 * 수행하고, 서버에는 인코딩 완료된 JSON만 보낸다 — Supabase 엣지 함수의 CPU
 * 2초 한도(오류 546)를 피하기 위한 핵심 설계. 배치(≤4개, base64 ≤6MB)로 나눠
 * 순차 판독(extract)한 뒤 전체를 종합(synthesize)한다. 합계는 모델을 믿지 않고
 * 클라이언트에서 재검산한다. Anthropic 키는 서버 시크릿에만 존재하며 서류는
 * 저장되지 않는다.
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ExtractedDoc {
  index: number
  docType: string
  insurer?: string | null
  policyNo?: string | null
  coverages: { name: string; amount?: number | string; payRule?: string; clause?: string }[]
  medicalFacts: { date?: string; fact: string; cost?: string | number }[]
  notes?: string
  /** 클라이언트가 붙이는 원본 파일명 (배치 오프셋 매핑). */
  fileName?: string
}

export type BasisSource = 'clause-confirmed' | 'web-confirmed' | 'policy-stated' | 'standard-estimate'

export interface ClaimItem {
  coverage: string
  amount: number
  calc?: string
  basis: string
  basisSource: BasisSource
}

export interface ClaimCompany {
  name: string
  items: ClaimItem[]
  subtotal: number
}

export interface ClaimExpertResult {
  companies: ClaimCompany[]
  grandTotal: number
  /** 검토했지만 이번 건에 지급되지 않는 담보 — 사유와 함께 (전 담보 전수 검토). */
  excluded: { coverage: string; reason: string }[]
  hiddenClaims: { desc: string; amount?: number | null }[]
  cautions: string[]
  customerMessage: string
  neededDocs: string[]
  /** 판독된 문서 요약 (분류 칩 표시용). */
  docs: ExtractedDoc[]
}

export interface ClaimAppeal {
  appealLetter: string
  keyPoints: string[]
}

export interface ClaimProgress {
  stage: 'prepare' | 'extract' | 'synthesize'
  /** prepare: 현재 파일/전체 파일, extract: 현재 배치/전체 배치, synthesize: 0/0. */
  batch: number
  totalBatches: number
  /** 처리 중인 파일명들 (진행 표시용). */
  fileNames?: string[]
}

export interface SavedClaimAnalysis {
  id: string
  customerId: string | null
  createdAt: string
  result: ClaimExpertResult
}

// ── 공통 ─────────────────────────────────────────────────────────────────────

const EXTRACT_TIMEOUT_MS = 170000
const MAX_BATCH_FILES = 4
/** 배치당 base64 문자 수 한도 (~4.5MB 원본). 서버 JSON 파싱이 CPU 한도 안에 들도록. */
const MAX_BATCH_CHARS = 6_000_000
/** PDF는 압축이 불가능하므로 파일당 8MB 제한 (base64 ~10.7MB, 단독 배치로 전송). */
export const MAX_PDF_BYTES = 8 * 1024 * 1024
/** 이미지는 자동 압축되므로 원본 25MB까지 허용 (캔버스 메모리 보호선). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** 파일 크기 문제를 사람이 읽을 메시지로. 문제 없으면 null. */
export function fileSizeIssue(f: File): string | null {
  if (f.type === 'application/pdf' && f.size > MAX_PDF_BYTES) {
    return `"${f.name}" PDF가 너무 큽니다 (최대 8MB). 페이지를 나눠 다시 올려주세요.`
  }
  if (f.type !== 'application/pdf' && f.size > MAX_IMAGE_BYTES) {
    return `"${f.name}" 이미지가 너무 큽니다 (최대 25MB).`
  }
  return null
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

function endpoint(): { url: string; anon: string } | null {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return null
  return { url: `${base}/claim-expert`, anon }
}

export async function postJson(
  body: unknown,
  timeoutMs: number
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; disabled?: boolean }> {
  const ep = endpoint()
  if (!ep) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = (await bearer()) ?? ep.anon
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ep.anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !data?.success) {
      const disabled = data?.code === 'ANTHROPIC_API_KEY_MISSING'
      return { ok: false, error: String(data?.error ?? `분석 요청 실패 (HTTP ${res.status})`), disabled }
    }
    return { ok: true, data }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '분석 시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 종합(synthesize) 스트리밍 호출 — 서버가 NDJSON으로 진행 상태를 흘려보내면
 * onStatus로 전달하고, 마지막 result 이벤트를 postJson과 동일한 형태로 반환한다.
 * 구버전 서버(스트림 미지원)가 일반 JSON을 돌려주면 자동으로 그대로 처리한다.
 */
async function postSynthesizeStream(
  body: unknown,
  timeoutMs: number,
  onStatus: (text: string) => void
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; disabled?: boolean }> {
  const ep = endpoint()
  if (!ep) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  let timer = window.setTimeout(() => controller.abort(), timeoutMs)
  // 스트림이 살아 있는 동안은 청크마다 타이머를 연장한다 (침묵 60초 = 이상).
  const touch = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => controller.abort(), 60000)
  }
  const asResult = (data: Record<string, unknown> | null, status: number): { ok: boolean; data?: Record<string, unknown>; error?: string; disabled?: boolean } => {
    if (!data?.success) {
      const disabled = data?.code === 'ANTHROPIC_API_KEY_MISSING'
      return { ok: false, error: String(data?.error ?? `분석 요청 실패 (HTTP ${status})`), disabled }
    }
    return { ok: true, data }
  }
  try {
    const token = (await bearer()) ?? ep.anon
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ep.anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const ct = res.headers.get('content-type') ?? ''
    if (!res.body || !ct.includes('ndjson')) {
      // 구버전 함수 또는 즉시 오류 — 일반 JSON 경로
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return asResult(data, res.status)
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let final: Record<string, unknown> | null = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      touch()
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let ev: Record<string, unknown>
        try {
          ev = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        if (ev.type === 'status' && typeof ev.text === 'string') onStatus(ev.text)
        else if (ev.type === 'result') final = ev
      }
    }
    if (buf.trim() && !final) {
      try {
        const ev = JSON.parse(buf) as Record<string, unknown>
        if (ev.type === 'result') final = ev
      } catch {
        /* ignore */
      }
    }
    return asResult(final, res.status)
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '분석 시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

// ── 1) prepare: 압축 + 인코딩 (전부 클라이언트에서) ──────────────────────────

/** 인코딩 완료된 서류 한 건 — 서버에 그대로 전달되는 형태. */
interface PreparedDoc {
  name: string
  mediaType: string
  /** base64 본문 (data URL prefix 제거됨). */
  data: string
}

const IMG_MAX_DIM = 2200
const IMG_QUALITY = 0.82
/** 이보다 작은 이미지는 압축 생략 (이미 가벼움) — 단, 지원 형식일 때만. */
const COMPRESS_SKIP_BYTES = 500 * 1024
/** Anthropic이 받는 이미지 형식. 그 외(HEIC/TIFF/BMP 등)는 반드시 JPEG로 변환해야 한다. */
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
/** 이미지 1장당 base64 한도 (Anthropic 10MB) — 여유를 둔 하드캡. */
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

/** 캔버스로 JPEG 재인코딩. 디코딩 실패 시 null. */
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

/**
 * 촬영 사진 준비: 지원 형식(JPG/PNG/GIF/WebP)은 크면 축소, 작으면 그대로.
 * 비지원 형식(HEIC/TIFF/BMP 등)은 크기와 무관하게 반드시 JPEG로 변환 —
 * 변환 불가면 파일명을 지목한 오류 반환 (그대로 보내면 AI가 400으로 거부).
 */
async function prepareImage(file: File): Promise<{ ok: true; blob: Blob; mediaType: string } | { ok: false; error: string }> {
  const isSupported = SUPPORTED_IMAGE_TYPES.has(file.type)
  if (isSupported && file.size <= COMPRESS_SKIP_BYTES) return { ok: true, blob: file, mediaType: file.type }
  const jpeg = await reencodeToJpeg(file)
  if (jpeg) {
    // 지원 형식인데 재인코딩이 오히려 크면 원본 유지. 비지원 형식은 무조건 변환본 사용.
    if (isSupported && jpeg.size >= file.size) return { ok: true, blob: file, mediaType: file.type }
    return { ok: true, blob: jpeg, mediaType: 'image/jpeg' }
  }
  if (isSupported) return { ok: true, blob: file, mediaType: file.type }
  return {
    ok: false,
    error: `"${file.name}" 사진 형식(${file.type || '알 수 없음'})은 지원되지 않습니다. 갤러리에서 JPG로 저장하거나 스크린샷으로 다시 올려주세요.`
  }
}

/** 보관함 원본 약관(storage) 내려받아 classify용 PreparedDoc으로. 실패 시 null (조용히 생략). */
async function downloadTermsOriginal(filePath: string): Promise<PreparedDoc | null> {
  try {
    await initSupabaseClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSupabaseClient() as any
    if (!client) return null
    const { data, error } = await client.storage.from('policy-terms').download(filePath)
    if (error || !data) return null
    const blob = data as Blob
    if (blob.size === 0 || blob.size > 8 * 1024 * 1024) return null
    const b64 = await blobToBase64(blob)
    const ext = (filePath.split('.').pop() ?? '').toLowerCase()
    const mediaType = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg'
    return { name: filePath.split('/').pop() ?? '약관', mediaType, data: b64 }
  } catch {
    return null
  }
}

/** 파일 전체를 순차 준비 (압축→인코딩→검증). 진행 콜백 제공. */
async function prepareFiles(
  files: File[],
  onProgress?: (p: ClaimProgress) => void
): Promise<{ ok: true; docs: PreparedDoc[] } | { ok: false; error: string }> {
  const prepared: PreparedDoc[] = []
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i]
    onProgress?.({ stage: 'prepare', batch: i + 1, totalBatches: files.length, fileNames: [f.name] })
    let doc: PreparedDoc
    if (f.type === 'application/pdf') {
      doc = { name: f.name, mediaType: 'application/pdf', data: await blobToBase64(f) }
    } else {
      const img = await prepareImage(f)
      if (!img.ok) return { ok: false, error: img.error }
      doc = { name: f.name, mediaType: img.mediaType, data: await blobToBase64(img.blob) }
    }
    if (!doc.data) {
      return { ok: false, error: `"${f.name}" 파일이 비어 있습니다 (0바이트). 클라우드에서 원본을 내려받은 뒤 다시 올려주세요.` }
    }
    if (doc.mediaType !== 'application/pdf' && doc.data.length > MAX_IMAGE_B64_CHARS) {
      return { ok: false, error: `"${f.name}" 사진이 압축 후에도 너무 큽니다. 문서 부분만 잘라 다시 촬영해 올려주세요.` }
    }
    prepared.push(doc)
  }
  return { ok: true, docs: prepared }
}

// ── 2) extract: 배치 판독 (JSON — 서버는 조립만) ─────────────────────────────

/** 준비된 서류를 개수·base64 용량 기준으로 배치 분할. 순서 보존. */
export function splitBatches(docs: PreparedDoc[]): PreparedDoc[][] {
  const batches: PreparedDoc[][] = []
  let cur: PreparedDoc[] = []
  let curChars = 0
  for (const d of docs) {
    if (cur.length > 0 && (cur.length >= MAX_BATCH_FILES || curChars + d.data.length > MAX_BATCH_CHARS)) {
      batches.push(cur)
      cur = []
      curChars = 0
    }
    cur.push(d)
    curChars += d.data.length
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

async function extractBatch(batch: PreparedDoc[]): Promise<{ ok: boolean; docs?: ExtractedDoc[]; error?: string; disabled?: boolean }> {
  const res = await postJson({ mode: 'extract', files: batch }, EXTRACT_TIMEOUT_MS)
  if (!res.ok) return { ok: false, error: res.error, disabled: res.disabled }
  const raw = res.data?.docs
  if (!Array.isArray(raw)) return { ok: false, error: '서류 판독 결과가 비어 있습니다. 다시 시도해 주세요.' }
  // 모델이 문서 수를 다르게 반환하면 index→파일명 대응을 신뢰할 수 없다 — 그때는 파일명 생략.
  const names = raw.length === batch.length ? batch.map((b) => b.name) : []
  const docs = (raw as Record<string, unknown>[]).map((d, i) => normalizeDoc(d, i, names))
  return { ok: true, docs }
}

function normalizeDoc(d: Record<string, unknown>, i: number, names: string[]): ExtractedDoc {
  const idx = typeof d.index === 'number' ? d.index : i + 1
  return {
    index: idx,
    docType: String(d.docType ?? '기타'),
    insurer: d.insurer ? String(d.insurer) : null,
    policyNo: d.policyNo ? String(d.policyNo) : null,
    coverages: Array.isArray(d.coverages)
      ? (d.coverages as Record<string, unknown>[]).map((c) => ({
          name: String(c.name ?? ''),
          amount: typeof c.amount === 'number' ? c.amount : c.amount ? String(c.amount) : undefined,
          payRule: c.payRule ? String(c.payRule) : undefined,
          clause: c.clause ? String(c.clause) : undefined
        }))
      : [],
    medicalFacts: Array.isArray(d.medicalFacts)
      ? (d.medicalFacts as Record<string, unknown>[]).map((m) => ({
          date: m.date ? String(m.date) : undefined,
          fact: String(m.fact ?? ''),
          cost: typeof m.cost === 'number' ? m.cost : m.cost ? String(m.cost) : undefined
        }))
      : [],
    notes: d.notes ? String(d.notes) : undefined,
    fileName: names[idx - 1] ?? names[i]
  }
}

// ── 2) synthesize: 종합 + 재검산 ─────────────────────────────────────────────

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? Math.round(n) : 0
  }
  return 0
}

/** 모델 산수는 믿지 않는다 — 소계·총계를 items에서 다시 계산. */
function reconcile(companies: ClaimCompany[]): { companies: ClaimCompany[]; grandTotal: number } {
  let grand = 0
  const fixed = companies.map((c) => {
    const subtotal = c.items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0)
    grand += subtotal
    return { ...c, subtotal }
  })
  return { companies: fixed, grandTotal: grand }
}

function normalizeResult(raw: Record<string, unknown>, docs: ExtractedDoc[]): ClaimExpertResult {
  const companies: ClaimCompany[] = Array.isArray(raw.companies)
    ? (raw.companies as Record<string, unknown>[]).map((c) => ({
        name: String(c.name ?? '보험사'),
        subtotal: toNumber(c.subtotal),
        items: Array.isArray(c.items)
          ? (c.items as Record<string, unknown>[]).map((it) => ({
              coverage: String(it.coverage ?? ''),
              amount: toNumber(it.amount),
              calc: it.calc ? String(it.calc) : undefined,
              basis: String(it.basis ?? ''),
              basisSource:
                it.basisSource === 'clause-confirmed'
                  ? 'clause-confirmed'
                  : it.basisSource === 'web-confirmed'
                    ? 'web-confirmed'
                    : it.basisSource === 'policy-stated'
                      ? 'policy-stated'
                      : 'standard-estimate'
            }))
          : []
      }))
    : []
  const { companies: fixed, grandTotal } = reconcile(companies)
  return {
    companies: fixed,
    grandTotal,
    excluded: Array.isArray(raw.excluded)
      ? (raw.excluded as Record<string, unknown>[]).map((e) => ({
          coverage: String(e.coverage ?? ''),
          reason: String(e.reason ?? '')
        }))
      : [],
    hiddenClaims: Array.isArray(raw.hiddenClaims)
      ? (raw.hiddenClaims as Record<string, unknown>[]).map((h) => ({
          desc: String(h.desc ?? ''),
          amount: h.amount == null ? null : toNumber(h.amount)
        }))
      : [],
    cautions: Array.isArray(raw.cautions) ? (raw.cautions as unknown[]).map(String) : [],
    customerMessage: String(raw.customerMessage ?? ''),
    neededDocs: Array.isArray(raw.neededDocs) ? (raw.neededDocs as unknown[]).map(String) : [],
    docs
  }
}

/**
 * 회사별 분할 종합의 부분 결과들을 하나로 합친다. 합계는 reconcile로 재검산하고,
 * 고객 안내문은 합쳐진 총액 기준으로 새로 조립한다 (부분 안내문은 자기 회사 총액만 알므로).
 */
function mergeResults(parts: ClaimExpertResult[]): ClaimExpertResult {
  const dedupe = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))]
  const { companies, grandTotal } = reconcile(parts.flatMap((p) => p.companies))
  const seenHidden = new Set<string>()
  const hiddenClaims = parts
    .flatMap((p) => p.hiddenClaims)
    .filter((h) => (seenHidden.has(h.desc) ? false : (seenHidden.add(h.desc), true)))
  const perCompany = companies.map((c) => `${c.name} ${won(c.subtotal)}`).join(', ')
  const customerMessage = [
    `안녕하세요, 보험금 청구 검토 결과를 안내드립니다. 예상 보험금은 총 ${won(grandTotal)}입니다.`,
    companies.length > 1 ? `회사별로는 ${perCompany} 입니다.` : '',
    hiddenClaims.length > 0 ? '아직 청구되지 않은 것으로 보이는 건도 함께 확인해 드리겠습니다.' : '',
    '청구에 필요한 서류와 절차는 제가 도와드릴게요. 궁금한 점은 편하게 문의 주세요!'
  ]
    .filter(Boolean)
    .join(' ')
  return {
    companies,
    grandTotal,
    excluded: parts.flatMap((p) => p.excluded),
    hiddenClaims,
    cautions: dedupe(parts.flatMap((p) => p.cautions)),
    customerMessage,
    neededDocs: dedupe(parts.flatMap((p) => p.neededDocs)),
    docs: parts[0]?.docs ?? []
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 전체 파이프라인: 준비(압축·인코딩) → 배치 판독(순차) → 종합.
 * onProgress로 단계/진행을 알린다. 실패해도 throw하지 않는다.
 */
export async function analyzeClaimExpert(args: {
  files: File[]
  customerName?: string
  onProgress?: (p: ClaimProgress) => void
  /** 보관함 약관 요약들 — 판독 후 보험사 매칭용 (페이지가 전체 목록을 넘긴다). filePath는 수술분류표 정밀 조회용 원본 위치. */
  policyTerms?: { id: string; insurer: string; summary: unknown; filePath?: string }[]
  /** 수동으로 강제 포함할 보관함 약관 id들. */
  forcedTermIds?: string[]
}): Promise<{ ok: boolean; result?: ClaimExpertResult; error?: string; disabled?: boolean; usedTerms?: string[]; webTerms?: unknown[] }> {
  const files = args.files.filter(Boolean)
  if (files.length === 0) return { ok: false, error: '분석할 서류를 먼저 올려주세요.' }
  for (const f of files) {
    const issue = fileSizeIssue(f)
    if (issue) return { ok: false, error: issue }
  }

  let preparedRes: Awaited<ReturnType<typeof prepareFiles>>
  try {
    preparedRes = await prepareFiles(files, args.onProgress)
  } catch {
    return { ok: false, error: '서류를 준비하는 중 오류가 발생했습니다. 다시 시도해 주세요.' }
  }
  if (!preparedRes.ok) return { ok: false, error: preparedRes.error }

  const batches = splitBatches(preparedRes.docs)
  // 병렬 판독 (동시 3개) — 순차 대비 서류가 많을수록 크게 빨라진다.
  // 결과는 배치 순서대로 재조립하고, 일시 혼잡(429 등)은 배치별 1회 재시도로 흡수.
  const CONCURRENCY = 3
  const batchResults: (ExtractedDoc[] | null)[] = new Array(batches.length).fill(null)
  let nextIdx = 0
  let done = 0
  let firstError: { error?: string; disabled?: boolean; at: number } | null = null
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIdx
      nextIdx += 1
      if (i >= batches.length || firstError) return
      args.onProgress?.({ stage: 'extract', batch: Math.min(done + 1, batches.length), totalBatches: batches.length, fileNames: batches[i].map((f) => f.name) })
      let res = await extractBatch(batches[i])
      if (!res.ok && !res.disabled) {
        await new Promise((r) => setTimeout(r, 3000))
        res = await extractBatch(batches[i])
      }
      if (!res.ok) {
        if (!firstError) firstError = { error: res.error, disabled: res.disabled, at: i }
        return
      }
      batchResults[i] = res.docs ?? []
      done += 1
      args.onProgress?.({ stage: 'extract', batch: Math.min(done + 1, batches.length), totalBatches: batches.length, fileNames: batches[Math.min(nextIdx, batches.length - 1)]?.map((f) => f.name) })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()))
  if (firstError) {
    const fe = firstError as { error?: string; disabled?: boolean; at: number }
    const at = batches.length > 1 ? ` (배치 ${fe.at + 1}/${batches.length})` : ''
    return { ok: false, error: `${fe.error}${at}`, disabled: fe.disabled }
  }
  const allDocs: ExtractedDoc[] = []
  for (const docs of batchResults) {
    for (const d of docs ?? []) allDocs.push({ ...d, index: allDocs.length + 1 })
  }
  if (allDocs.length === 0) return { ok: false, error: '서류에서 내용을 읽지 못했습니다. 선명한 사본으로 다시 시도해 주세요.' }

  // 보관함 약관 매칭: 증권의 보험사명 ↔ 보관함 보험사명 (수동 강제 포함 병합)
  const normName = (s: string): string => s.replace(/\s/g, '').toLowerCase()
  const docInsurers = allDocs.map((d) => normName(String(d.insurer ?? ''))).filter(Boolean)
  const matched = (args.policyTerms ?? []).filter((t) => {
    if ((args.forcedTermIds ?? []).includes(t.id)) return true
    const ti = normName(t.insurer)
    return ti && docInsurers.some((w) => w.includes(ti) || ti.includes(w))
  }).slice(0, 10)

  // 종별 수술비 감지 시 — 약관 "원본"을 다시 열어 수술분류표에서 해당 수술의 종을 직접 확정.
  // 약관 소스: ① 이번 분석에 함께 올린 약관 문서 ② 보관함 매칭분의 원본 PDF(storage).
  const CLASS_RE = /[1-9]\s*종/
  const hasClassCoverage = allDocs.some((d) => d.coverages.some((c) => CLASS_RE.test(c.name) || CLASS_RE.test(String(c.payRule ?? ''))))
  const surgeries = allDocs
    .flatMap((d) => d.medicalFacts.filter((m) => /수술|절제|절개|정복|고정술|성형술/.test(m.fact)).map((m) => m.fact))
    .slice(0, 10)
  let surgeryClasses: unknown[] = []
  if (hasClassCoverage && surgeries.length > 0) {
    let src: PreparedDoc | null = null
    const termsDoc = allDocs.find((d) => d.docType === '약관')
    if (termsDoc?.fileName) src = preparedRes.docs.find((p) => p.name === termsDoc.fileName) ?? null
    if (!src) {
      const withFile = matched.find((t) => t.filePath && !/^https?:/.test(t.filePath) && t.filePath !== 'web')
      if (withFile?.filePath) src = await downloadTermsOriginal(withFile.filePath)
    }
    if (src) {
      args.onProgress?.({ stage: 'synthesize', batch: 0, totalBatches: 0, fileNames: ['수술분류표에서 종 확인 중'] })
      const cls = await postJson({ mode: 'classify', file: src, surgeries }, 170000)
      if (cls.ok && Array.isArray(cls.data?.classifications)) surgeryClasses = cls.data.classifications as unknown[]
    }
  }

  args.onProgress?.({ stage: 'synthesize', batch: 0, totalBatches: 0 })
  // 서버가 흘려보내는 실시간 상태(웹 검색·작성량)를 진행 패널로 전달.
  let statusCount = 0
  const onStatus = (text: string): void => {
    statusCount += 1
    args.onProgress?.({ stage: 'synthesize', batch: statusCount, totalBatches: 0, fileNames: [text] })
  }

  // 잘림 원천 차단 — 증권상 보험사가 많으면(3곳 이상) 회사별로 나눠 종합한다.
  // 한 번의 거대한 JSON 생성이 max_tokens에 잘려 마지막 회사가 유실되는 것을 막고,
  // 합계·안내문은 클라이언트가 합치며 재검산한다. 보험사 표기가 없는 의료 서류는
  // 어느 회사 계산에도 필요하므로 모든 그룹에 포함한다.
  const insurerOf = (d: ExtractedDoc): string => normName(String(d.insurer ?? ''))
  const policyInsurers = [...new Set(allDocs.filter((d) => d.docType === '증권' && insurerOf(d)).map(insurerOf))]
  const groups: { label: string; docs: ExtractedDoc[] }[] =
    policyInsurers.length >= 3
      ? policyInsurers.map((ins, i) => ({
          label: `회사 ${i + 1}/${policyInsurers.length}`,
          docs: allDocs.filter((d) => !insurerOf(d) || insurerOf(d) === ins)
        }))
      : [{ label: '', docs: allDocs }]

  const parts: ClaimExpertResult[] = []
  let totalDropped = 0
  let anyTruncated = false
  const webTerms: unknown[] = []
  for (const g of groups) {
    const prefix = g.label ? `${g.label} — ` : ''
    const groupStatus = (text: string): void => onStatus(`${prefix}${text}`)
    if (g.label) groupStatus('보험금 계산 시작')
    const synthBody = {
      mode: 'synthesize',
      stream: true,
      docs: g.docs.map(({ fileName: _fileName, ...rest }) => rest),
      customerName: args.customerName ?? '',
      termsSummaries: matched.map((t) => t.summary),
      surgeryClasses
    }
    let synth = await postSynthesizeStream(synthBody, 170000, groupStatus)
    if (!synth.ok && !synth.disabled) {
      // 종합만 자동 1회 재시도 — 판독(배치) 결과는 재사용하므로 처음부터 다시 할 필요 없음.
      synth = await postSynthesizeStream(synthBody, 170000, groupStatus)
    }
    if (!synth.ok) {
      return { ok: false, error: g.label ? `${synth.error} (${g.label})` : synth.error, disabled: synth.disabled }
    }
    const raw = (synth.data?.result ?? null) as Record<string, unknown> | null
    if (!raw) return { ok: false, error: '종합 결과가 비어 있습니다. 다시 시도해 주세요.' }
    parts.push(normalizeResult(raw, allDocs))
    totalDropped += Number((synth.data as { droppedDocs?: unknown })?.droppedDocs ?? 0)
    anyTruncated = anyTruncated || Boolean((synth.data as { truncated?: unknown })?.truncated)
    if (Array.isArray((raw as { webTerms?: unknown }).webTerms)) webTerms.push(...((raw as { webTerms: unknown[] }).webTerms))
  }

  const result = parts.length === 1 ? parts[0] : mergeResults(parts)
  // 서버가 용량 한도로 뒤쪽 문서를 계산에서 제외했다면 반드시 겉으로 알린다.
  if (totalDropped > 0) {
    result.cautions = [
      `⚠️ 서류가 너무 많아 ${totalDropped}건은 이번 금액 계산에 포함되지 못했습니다. 남은 서류는 나눠서 한 번 더 분석해 주세요.`,
      ...result.cautions
    ]
  }
  // AI 응답이 길이 한도에 걸려 복구된 경우 — 마지막 일부 항목이 빠졌을 수 있음을 알린다.
  if (anyTruncated) {
    result.cautions = ['⚠️ 결과가 매우 길어 마지막 일부 항목이 생략됐을 수 있습니다. 서류를 나눠 다시 분석하면 전체를 확인할 수 있습니다.', ...result.cautions]
  }
  return { ok: true, result, usedTerms: matched.map((t) => t.id), webTerms }
}

/** 부지급/삭감 통보 → 약관 조항 근거 재검토 요청서 생성. */
export async function generateAppeal(args: {
  result: ClaimExpertResult
  rejection: string
}): Promise<{ ok: boolean; appeal?: ClaimAppeal; error?: string }> {
  if (!args.rejection.trim()) return { ok: false, error: '보상팀의 거절/삭감 사유를 입력해 주세요.' }
  const analysis = { companies: args.result.companies, grandTotal: args.result.grandTotal, docs: args.result.docs.map(({ fileName: _f, ...rest }) => rest) }
  const body = { mode: 'appeal', analysis, rejection: args.rejection }
  let res = await postJson(body, 120000)
  if (!res.ok && !res.disabled) res = await postJson(body, 120000) // 자동 1회 재시도
  if (!res.ok) return { ok: false, error: res.error }
  const raw = (res.data?.appeal ?? null) as { appealLetter?: unknown; keyPoints?: unknown } | null
  if (!raw?.appealLetter) return { ok: false, error: '요청서 생성에 실패했습니다. 다시 시도해 주세요.' }
  return {
    ok: true,
    appeal: {
      appealLetter: String(raw.appealLetter),
      keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints.map(String) : []
    }
  }
}

// ── 저장/조회 (claim_analyses) ───────────────────────────────────────────────

type Db = {
  auth: { getUser: () => Promise<{ data?: { user?: { id?: string } } }> }
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } }
    select: (c: string) => {
      eq: (k: string, v: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> } }
    }
  }
}

/** 고객이 선택된 분석 결과를 고객 기록(claim_analyses)에 저장. */
export async function saveClaimAnalysis(customerId: string, result: ClaimExpertResult): Promise<{ ok: boolean; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db | null
    if (!db) return { ok: false, error: '서버 연결 후 저장할 수 있습니다.' }
    const { data: u } = await db.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return { ok: false, error: '로그인 후 저장할 수 있습니다.' }
    const stored = { ...result, docs: result.docs.map(({ fileName: _f, ...rest }) => rest) }
    const { error } = await db.from('claim_analyses').insert({ customer_id: customerId, staff_id: uid, result: stored }).select('id').single()
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }
}

/** 특정 고객의 지난 분석 목록 (최신순 10건). */
export async function listClaimAnalyses(customerId: string): Promise<{ ok: boolean; items: SavedClaimAnalysis[]; error?: string }> {
  try {
    await initSupabaseClient()
    const db = getSupabaseClient() as Db | null
    if (!db) return { ok: false, items: [] }
    const { data, error } = await db.from('claim_analyses').select('id, customer_id, created_at, result').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10)
    if (error) return { ok: false, items: [], error: error.message }
    const rows = (data as { id: string; customer_id: string | null; created_at: string; result: unknown }[]) ?? []
    return {
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        createdAt: r.created_at,
        result: r.result as ClaimExpertResult
      }))
    }
  } catch {
    return { ok: false, items: [] }
  }
}

/** 원화 표기: 1,234,567원 (만원 단위 병기). */
export function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}
