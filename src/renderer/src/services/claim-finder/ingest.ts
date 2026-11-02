/**
 * SJ CLAIM FINDER — 원본 파일 수집(ingest) 기반.
 *
 * 역할: 사용자가 올린 원본(심평원 진료 JSON / KB 보장분석 PDF)을
 *   (1) 형식·크기 검증 → (2) 원본 해시(provenance) 계산 → (3) 구조적 파싱(추측 금지) →
 *   (4) 사람이 확인/수정할 수 있는 **스테이징 결과**로 변환한다.
 *
 * 설계 원칙(리뷰 반영):
 *  - **실제 HIRA/KB 포맷 정확도는 미검증**이다. 실제 샘플 확보 전까지 JSON 은 어댑터의
 *    '관측된 필드만' 매핑을 재사용하고, PDF 는 **자동 담보 추출을 하지 않는다**
 *    (페이지별 텍스트만 추출 → 사람이 확인/입력). 구조를 모르면 추측하지 않고 오류/경고로 남긴다.
 *  - **미설정 시 안전 비활성**: PDF 추출기(pdfjs)가 주입되지 않으면 비활성 상태로 명확히 보고한다
 *    (조용히 성공했다고 하지 않는다). → extractPdfPages 의존성 주입(DI)으로 코어는 단독 테스트.
 *  - **provenance**: 모든 결과에 fileHash(SHA-256)·bytes·파일명을 남겨 원본 대조/감사 가능.
 */

import type { TreatmentEvent } from './claimRules'
import { treatmentsFromHealthRecordResult } from './adapters'

export const INGEST_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10MB — 원본 과대 업로드 차단
  minBytes: 4
} as const

export type IngestFileKind = 'health_record_json' | 'coverage_pdf'

export interface IngestInput {
  name: string
  /** 선언된 MIME(브라우저 File.type). 신뢰하지 않고 내용 스니핑과 함께 검증한다. */
  declaredType?: string
  bytes: Uint8Array
}

export interface PdfPageText {
  page: number
  text: string
}

export interface IngestResult {
  ok: boolean
  kind?: IngestFileKind
  fileName: string
  fileHash?: string // sha256 hex
  bytes: number
  /** JSON 경로: 구조적으로 추출된 진료 이벤트(추측 없음). */
  events?: TreatmentEvent[]
  /** PDF 경로: 페이지별 원문 텍스트(자동 담보 매핑 안 함 — 사람이 확인/입력). */
  pages?: PdfPageText[]
  /** PDF 는 항상 사람 확인 필요(자동 금액/담보 산정하지 않음). */
  needsManualReview?: boolean
  warnings: string[]
  errors: string[]
}

/** PDF 텍스트 추출기(주입). 미주입이면 PDF 수집은 '비활성'으로 처리된다. */
export type PdfPageExtractor = (bytes: Uint8Array) => Promise<PdfPageText[]>

export interface IngestOptions {
  limits?: { maxBytes?: number; minBytes?: number }
  /** 주입 안 하면 PDF 는 안전하게 비활성화된다. */
  extractPdfPages?: PdfPageExtractor
  /** 해시 함수 주입(테스트용). 기본은 Web Crypto SHA-256. */
  sha256?: (bytes: Uint8Array) => Promise<string>
  /** provenance 메모(예: requestId). */
  requestId?: string
}

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

/** 선행 공백/BOM 을 건너뛰고 첫 비공백 바이트를 본다. */
function firstNonSpace(bytes: Uint8Array): number {
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const b = bytes[i]
    if (b === 0xef || b === 0xbb || b === 0xbf) continue // UTF-8 BOM
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue
    return b
  }
  return 0
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-"
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

function looksLikeJson(bytes: Uint8Array): boolean {
  const c = firstNonSpace(bytes)
  return c === 0x7b || c === 0x5b // '{' or '['
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)\s*$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

async function defaultSha256(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) throw new Error('no-subtle-crypto')
  // 새 ArrayBuffer 로 복사해 전달(SharedArrayBuffer 가능성 배제 — lib.dom BufferSource 요건).
  const copy = new Uint8Array(bytes)
  const digest = await subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 파일 종류 판별: 확장자 + 선언 MIME + 내용 스니핑을 **모두** 고려하되,
 * 내용이 우선이다(선언만 믿지 않음). 애매하면 undefined(→ 오류 처리).
 */
export function detectKind(input: IngestInput): IngestFileKind | undefined {
  const ext = extOf(input.name)
  const t = (input.declaredType || '').toLowerCase()
  if (looksLikePdf(input.bytes)) return 'coverage_pdf'
  if (looksLikeJson(input.bytes)) return 'health_record_json'
  // 내용 스니핑 실패 시 선언/확장자로 최후 판단(그래도 파싱에서 재검증).
  if (ext === 'pdf' || t.includes('pdf')) return 'coverage_pdf'
  if (ext === 'json' || t.includes('json')) return 'health_record_json'
  return undefined
}

export async function ingestFile(input: IngestInput, opts: IngestOptions = {}): Promise<IngestResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const bytes = input.bytes
  const res: IngestResult = { ok: false, fileName: input.name || '(이름없음)', bytes: bytes?.byteLength ?? 0, warnings, errors }

  // 0) 기본 방어
  if (!bytes || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    errors.push('빈 파일이거나 바이트를 읽지 못했습니다.')
    return res
  }
  const maxBytes = opts.limits?.maxBytes ?? INGEST_LIMITS.maxBytes
  const minBytes = opts.limits?.minBytes ?? INGEST_LIMITS.minBytes
  if (bytes.byteLength > maxBytes) {
    errors.push(`파일이 너무 큽니다(${bytes.byteLength}B > 최대 ${maxBytes}B).`)
    return res
  }
  if (bytes.byteLength < minBytes) {
    errors.push('파일이 너무 작아 유효한 원본이 아닙니다.')
    return res
  }

  // 1) 종류 판별
  const kind = detectKind(input)
  if (!kind) {
    errors.push('지원하지 않는 파일 형식입니다. 심평원 진료 JSON 또는 KB 보장분석 PDF만 허용합니다.')
    return res
  }
  res.kind = kind

  // 2) provenance 해시(원본 대조용)
  try {
    res.fileHash = await (opts.sha256 ?? defaultSha256)(bytes)
  } catch {
    warnings.push('원본 해시(SHA-256)를 계산하지 못했습니다(provenance 일부 누락).')
  }

  // 3) 종류별 파싱
  if (kind === 'health_record_json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(decodeUtf8(bytes))
    } catch {
      errors.push('JSON 파싱 실패 — 유효한 심평원 진료 JSON 이 아닙니다(구조 미확인, 추측 안 함).')
      return res
    }
    // 어댑터 재사용: 코드에서 관측된 필드만 매핑, 없으면 null(추측 금지).
    const { events, warnings: w } = treatmentsFromHealthRecordResult(parsed, {
      fileHash: res.fileHash,
      requestId: opts.requestId
    })
    warnings.push(...w)
    if (events.length === 0) {
      errors.push('진료 레코드를 하나도 추출하지 못했습니다(알 수 없는 JSON 구조 — 사람 확인 필요).')
      res.events = []
      return res
    }
    warnings.push('⚠️ 실제 HIRA 포맷 정확도는 미검증입니다. 추출 결과를 사람이 확인하세요.')
    res.events = events
    res.ok = true
    return res
  }

  // kind === 'coverage_pdf'
  res.needsManualReview = true
  if (!opts.extractPdfPages) {
    errors.push('PDF 수집이 비활성 상태입니다(추출기 미설정). 담당자가 PDF 추출기를 연결한 뒤 사용하세요.')
    return res
  }
  let pages: PdfPageText[]
  try {
    pages = await opts.extractPdfPages(bytes)
  } catch (e) {
    errors.push('PDF 텍스트 추출 실패: ' + (e instanceof Error ? e.message : String(e)))
    return res
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push('PDF 에서 텍스트를 추출하지 못했습니다(스캔본이거나 지원하지 않는 구조 — 사람 확인 필요).')
    res.pages = []
    return res
  }
  const emptyPages = pages.filter((p) => !p.text || !p.text.trim()).map((p) => p.page)
  if (emptyPages.length) warnings.push(`텍스트가 없는 페이지(스캔 가능성): ${emptyPages.join(', ')}`)
  warnings.push(
    '⚠️ PDF 는 자동으로 담보/금액을 추출하지 않습니다. 페이지별 원문만 제공하며, 담보·가입금액은 사람이 약관과 대조해 입력/검증해야 합니다(KB 가입금액 ≠ 지급액).'
  )
  res.pages = pages
  res.ok = true
  return res
}
