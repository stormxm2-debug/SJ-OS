import { getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'
import { postJson } from './claimExpertService'

/**
 * 약관 보관함 — 회사·상품별 약관을 서버에 1회 등록하면:
 *  1) 클로드가 약관을 정독해 담보별 조항 요약(JSON)을 만들어 DB에 저장 (digest, 최초 1회)
 *  2) 이후 분석에서 증권의 보험사와 자동 매칭 → 요약을 종합 단계에 주입
 *     → 웹 검색·PDF 재판독 없이 즉시 🟢 약관 확인 근거 (속도·정확도 동시 확보)
 * PDF 원본은 storage(policy-terms 버킷)에 보관 (분쟁 대비 원본 열람용).
 * 등록: 전 직원 / 삭제: 관리자만 (RLS 강제).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TermsClause {
  coverage: string
  clause?: string
  payRule?: string
  exclusions?: string | null
}

export interface TermsSummary {
  insurer: string
  productName: string
  clauses: TermsClause[]
  notes?: string
}

export interface PolicyTerm {
  id: string
  insurer: string
  productName: string
  versionNote?: string
  filePath: string
  summary: TermsSummary
  createdAt: string
}

const MAX_TERMS_FILE = 8 * 1024 * 1024

async function db(): Promise<any | null> {
  await initSupabaseClient()
  return getSupabaseClient() as any
}

function rowToTerm(r: any): PolicyTerm {
  return {
    id: r.id,
    insurer: r.insurer ?? '',
    productName: r.product_name ?? '',
    versionNote: r.version_note ?? undefined,
    filePath: r.file_path ?? '',
    summary: (r.summary ?? { insurer: '', productName: '', clauses: [] }) as TermsSummary,
    createdAt: r.created_at
  }
}

/** 보관함 전체 목록 (최신순). */
export async function listPolicyTerms(): Promise<PolicyTerm[]> {
  const client = await db()
  if (!client) return []
  const { data, error } = await client
    .from('policy_terms')
    .select('id, insurer, product_name, version_note, file_path, summary, created_at')
    .order('created_at', { ascending: false })
  if (error || !Array.isArray(data)) return []
  return (data as any[]).map(rowToTerm)
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(new Error('read'))
    r.readAsDataURL(blob)
  })
}

/**
 * 약관 등록: 클로드 정독(digest) → PDF 원본 storage 업로드 → 요약과 함께 DB 저장.
 * 최초 1회 1~2분 — 이후 이 상품 분석은 영구히 빨라진다.
 */
export async function registerPolicyTerm(args: {
  file: File
  insurer: string
  productName: string
  versionNote?: string
  onProgress?: (msg: string) => void
}): Promise<{ ok: boolean; term?: PolicyTerm; error?: string }> {
  const { file } = args
  if (!args.insurer.trim() || !args.productName.trim()) return { ok: false, error: '보험사와 상품명을 입력해 주세요.' }
  const isPdf = file.type === 'application/pdf'
  if (!isPdf && !file.type.startsWith('image/')) return { ok: false, error: '약관은 PDF 또는 사진(JPG/PNG)으로 올려주세요.' }
  if (file.size > MAX_TERMS_FILE) return { ok: false, error: '약관 파일은 8MB 이하로 올려주세요 (필요 부분만 분할 가능).' }

  try {
    args.onProgress?.('클로드가 약관을 정독하는 중… (최초 1회, 1~2분)')
    const data = await fileToBase64(file)
    const digest = await postJson(
      { mode: 'digest', file: { name: file.name, mediaType: isPdf ? 'application/pdf' : file.type, data } },
      170000
    )
    if (!digest.ok) return { ok: false, error: digest.error }
    const rawSummary = (digest.data?.summary ?? null) as TermsSummary | null
    if (!rawSummary || !Array.isArray(rawSummary.clauses) || rawSummary.clauses.length === 0) {
      return { ok: false, error: '약관에서 조항을 읽지 못했습니다. 선명한 파일로 다시 시도해 주세요.' }
    }
    const summary: TermsSummary = {
      insurer: args.insurer.trim(),
      productName: args.productName.trim(),
      clauses: rawSummary.clauses,
      notes: rawSummary.notes
    }

    args.onProgress?.('원본 PDF 보관 중…')
    const client = await db()
    if (!client) return { ok: false, error: '서버 연결 후 등록할 수 있습니다.' }
    const { data: u } = await client.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return { ok: false, error: '로그인 후 등록할 수 있습니다.' }

    const ext = isPdf ? 'pdf' : (file.name.split('.').pop() ?? 'jpg').toLowerCase()
    const path = `${uid}/${crypto.randomUUID()}.${ext}`
    const up = await client.storage.from('policy-terms').upload(path, file, { contentType: file.type || 'application/pdf' })
    if (up.error) return { ok: false, error: '원본 저장에 실패했습니다: ' + up.error.message }

    const ins = await client
      .from('policy_terms')
      .insert({
        insurer: summary.insurer,
        product_name: summary.productName,
        version_note: args.versionNote?.trim() || null,
        file_path: path,
        summary,
        uploaded_by: uid
      })
      .select('id, insurer, product_name, version_note, file_path, summary, created_at')
      .single()
    if (ins.error) return { ok: false, error: '보관함 저장에 실패했습니다: ' + ins.error.message }
    return { ok: true, term: rowToTerm(ins.data) }
  } catch {
    return { ok: false, error: '약관 등록 중 오류가 발생했습니다. 다시 시도해 주세요.' }
  }
}

/** 약관 삭제 (관리자만 — RLS 강제). 원본 파일도 함께 정리. */
export async function deletePolicyTerm(term: PolicyTerm): Promise<{ ok: boolean; error?: string }> {
  const client = await db()
  if (!client) return { ok: false, error: '서버 연결 후 삭제할 수 있습니다.' }
  const { data, error } = await client.from('policy_terms').delete().eq('id', term.id).select('id')
  if (error) return { ok: false, error: error.message }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, error: '삭제 권한이 없습니다 (관리자만 삭제 가능).' }
  if (term.filePath) {
    await client.storage.from('policy-terms').remove([term.filePath]).catch(() => undefined)
  }
  return { ok: true }
}

/** 원본 PDF 열람용 서명 URL (1시간). */
export async function policyTermFileUrl(filePath: string): Promise<string | null> {
  const client = await db()
  if (!client) return null
  const { data } = await client.storage.from('policy-terms').createSignedUrl(filePath, 3600)
  return data?.signedUrl ?? null
}

const norm = (s: string): string => s.replace(/\s/g, '').toLowerCase()

/**
 * 웹 자동 보관: 분석 중 클로드가 웹에서 확인한 약관 조항(webTerms)을 보관함에
 * 자동 저장한다 — 같은 상품의 다음 분석부터는 검색 없이 즉시 재사용(사용자 등록 불필요).
 * 이미 같은 보험사·상품이 보관함에 있으면 건너뛴다. PDF 원본은 없고 출처 URL만 남긴다.
 */
export async function saveWebTerms(webTerms: unknown[], existing: PolicyTerm[]): Promise<PolicyTerm[]> {
  const client = await db()
  if (!client) return []
  const { data: u } = await client.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return []
  const known = new Set(existing.map((t) => norm(t.insurer + t.productName)))
  const added: PolicyTerm[] = []
  for (const raw of webTerms.slice(0, 5)) {
    const w = raw as { insurer?: unknown; productName?: unknown; sourceUrl?: unknown; clauses?: unknown }
    const insurer = String(w.insurer ?? '').trim()
    const productName = String(w.productName ?? '일반').trim() || '일반'
    const clauses = Array.isArray(w.clauses) ? (w.clauses as TermsClause[]) : []
    if (!insurer || clauses.length === 0) continue
    const key = norm(insurer + productName)
    if (known.has(key)) continue
    const sourceUrl = String(w.sourceUrl ?? '').slice(0, 500)
    const summary: TermsSummary & { source: string } = {
      insurer,
      productName,
      clauses,
      notes: sourceUrl ? `출처(웹 자동 수집): ${sourceUrl}` : '웹 자동 수집',
      source: 'web'
    }
    const ins = await client
      .from('policy_terms')
      .insert({
        insurer,
        product_name: productName,
        version_note: '웹 자동 수집',
        file_path: sourceUrl || 'web',
        summary,
        uploaded_by: uid
      })
      .select('id, insurer, product_name, version_note, file_path, summary, created_at')
      .single()
    if (!ins.error && ins.data) {
      known.add(key)
      added.push(rowToTerm(ins.data))
    }
  }
  return added
}

/**
 * 자동 매칭: 추출된 증권의 보험사명과 보관함 약관의 보험사명이 겹치면 해당 요약 선택.
 * (수동 선택분은 페이지에서 forcedIds로 합쳐진다.) 서버 한도에 맞춰 최대 10개.
 */
export function matchPolicyTerms(terms: PolicyTerm[], insurers: string[], forcedIds: string[] = []): PolicyTerm[] {
  const wanted = insurers.map(norm).filter(Boolean)
  const picked = new Map<string, PolicyTerm>()
  for (const t of terms) {
    if (forcedIds.includes(t.id)) {
      picked.set(t.id, t)
      continue
    }
    const ti = norm(t.insurer)
    if (ti && wanted.some((w) => w.includes(ti) || ti.includes(w))) picked.set(t.id, t)
  }
  return [...picked.values()].slice(0, 10)
}
