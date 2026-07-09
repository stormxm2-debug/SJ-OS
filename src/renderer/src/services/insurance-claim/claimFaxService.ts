import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import type { ClaimExpertResult } from './claimExpertService'

/**
 * 보험서류 자동청구(팩스 접수) 클라이언트.
 *
 * FC가 올린 서류를 최대 3개 보험사에 동시에 팩스로 청구 접수한다. 무거운 인코딩은
 * 전부 이 기기에서 하고 서버(send-claim-fax)에는 base64를 넘겨 그대로 솔라피에
 * 패스스루한다(청구비서 '546' CPU 한도 사건 교훈). 목적지 팩스번호는 서버가
 * insurer_fax 에서 조회하므로 클라이언트는 보내지 않는다.
 *
 * 지능형 라우팅: 청구비서 AI 분석 결과(companies·docs)를 이용해 "수술확인서→한화생명,
 * 진단서→DB손해"처럼 회사별로 보낼 서류를 자동 추천한다(FC가 최종 확인·수정).
 *
 * 설정 전(테이블 미적용/솔라피 키 미등록)에는 조용히 실패하지 않고 명시적으로
 * '설정 전' 상태를 돌려준다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface InsurerFax {
  id: string
  insurer: string
  fax: string
  label?: string
  memo?: string
  updatedAt: string
}

export interface FaxTargetStatus {
  id: string
  insurer: string
  fax: string
  filePaths: string[]
  status: 'queued' | 'sending' | 'sent' | 'failed'
  error?: string
  sentAt?: string
}

/** 회사별 서류 라우팅 추천 1건. */
export interface RoutingSuggestion {
  insurer: string
  /** files 배열 기준 인덱스 — 이 회사에 보낼 서류들. */
  fileIndexes: number[]
  /** 이 회사가 필요로 하는 서류 종류(설명용). */
  neededDocTypes: string[]
}

export interface RoutingPlan {
  /** files[i] 의 추정 서류종류(AI 분류 우선, 없으면 파일명 추정). */
  fileDocTypes: string[]
  /** 팩스로 보낼 수 있는 서류 인덱스(증권·약관 제외). */
  faxableIndexes: number[]
  perCompany: RoutingSuggestion[]
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

/** 테이블 미적용(42P01) 등 '설정 전' 신호인지. */
function isMissingSetup(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  return code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)
}

// ── 보험사 청구 팩스번호 (관리자) ─────────────────────────────────────────────

function mapFax(r: Record<string, any>): InsurerFax {
  return {
    id: String(r.id),
    insurer: String(r.insurer ?? ''),
    fax: String(r.fax ?? ''),
    label: (r.label as string | null) ?? undefined,
    memo: (r.memo as string | null) ?? undefined,
    updatedAt: String(r.updated_at ?? '')
  }
}

export async function listInsurerFax(): Promise<{ items: InsurerFax[]; configured: boolean }> {
  const client = await getClient()
  if (!client) return { items: [], configured: false }
  const { data, error } = await client.from('insurer_fax').select('*').order('insurer', { ascending: true })
  if (error) {
    if (isMissingSetup(error)) return { items: [], configured: false }
    return { items: [], configured: true }
  }
  return { items: ((data ?? []) as Record<string, any>[]).map(mapFax), configured: true }
}

export async function upsertInsurerFax(input: {
  id?: string
  insurer: string
  fax: string
  label?: string
  memo?: string
}): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const userId = await uid(client)
  const row = {
    insurer: input.insurer.trim(),
    fax: input.fax.replace(/[^\d-]/g, '').trim(),
    label: input.label?.trim() || null,
    memo: input.memo?.trim() || null,
    updated_by: userId
  }
  if (!row.insurer || !row.fax) return { ok: false, error: '보험사와 팩스번호를 입력해주세요.' }
  const q = input.id
    ? client.from('insurer_fax').update(row).eq('id', input.id)
    : client.from('insurer_fax').upsert(row, { onConflict: 'insurer' })
  const { error } = await q
  if (error) return { ok: false, error: error.message ?? '저장에 실패했습니다.' }
  return { ok: true }
}

export async function deleteInsurerFax(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { error } = await client.from('insurer_fax').delete().eq('id', id)
  if (error) return { ok: false, error: error.message ?? '삭제에 실패했습니다.' }
  return { ok: true }
}

// ── 지능형 라우팅 (순수 함수) ─────────────────────────────────────────────────

/** 보험사에 팩스로 보내지 않는 서류(우리 보관용/참고용). */
const NEVER_FAX = ['증권', '약관']

/** 담보 키워드 → 필요한 서류 종류. 위에서부터 매칭(첫 매칭만). */
const COVERAGE_DOC_RULES: { re: RegExp; docs: string[] }[] = [
  { re: /수술/, docs: ['수술확인서', '진단서'] },
  { re: /사망/, docs: ['사망진단서'] },
  { re: /장해|후유/, docs: ['장해진단서', '진단서'] },
  { re: /입원|일당/, docs: ['입퇴원확인서', '진단서'] },
  { re: /실손|통원|외래|의료비|약제|처방/, docs: ['진료비영수증', '진료비세부내역서', '진단서'] },
  { re: /암|뇌|심장|심근|졸중|출혈|진단/, docs: ['진단서'] },
  { re: /골절|화상|깁스|상해/, docs: ['진단서'] }
]

/** 파일명 기반 서류종류 추정(AI 분류가 없을 때 폴백). */
function guessDocTypeFromName(name: string): string {
  const n = name.toLowerCase()
  if (/수술/.test(name)) return '수술확인서'
  if (/진단/.test(name)) return '진단서'
  if (/입원|퇴원/.test(name)) return '입퇴원확인서'
  if (/영수증|receipt/.test(n)) return '진료비영수증'
  if (/세부|내역/.test(name)) return '진료비세부내역서'
  if (/처방/.test(name)) return '처방전'
  if (/증권|policy/.test(n)) return '증권'
  if (/약관/.test(name)) return '약관'
  return '기타'
}

function neededDocsForCompany(coverages: string[]): string[] {
  const out = new Set<string>()
  for (const cov of coverages) {
    for (const rule of COVERAGE_DOC_RULES) {
      if (rule.re.test(cov)) {
        rule.docs.forEach((d) => out.add(d))
        break
      }
    }
  }
  if (out.size === 0) out.add('진단서')
  return [...out]
}

function docMatches(fileDocType: string, needed: string[]): boolean {
  return needed.some((n) => fileDocType.includes(n) || n.includes(fileDocType))
}

/**
 * AI 분석 결과 + 업로드 파일 → 회사별 서류 라우팅 추천.
 * fileNames 는 files 배열과 같은 순서의 원본 파일명.
 */
export function suggestRouting(result: ClaimExpertResult, fileNames: string[]): RoutingPlan {
  const byName = new Map<string, string>()
  for (const d of result.docs ?? []) {
    if (d.fileName) byName.set(d.fileName, d.docType || '기타')
  }
  const fileDocTypes = fileNames.map((nm) => byName.get(nm) ?? guessDocTypeFromName(nm))
  const faxableIndexes = fileDocTypes
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !NEVER_FAX.some((x) => t.includes(x)))
    .map(({ i }) => i)

  const perCompany: RoutingSuggestion[] = (result.companies ?? []).map((c) => {
    const covs = c.items.map((it) => `${it.coverage} ${it.calc ?? ''}`)
    const needed = neededDocsForCompany(covs)
    let idx = faxableIndexes.filter((i) => docMatches(fileDocTypes[i], needed))
    // 매칭되는 서류가 없으면 팩스 가능한 서류 전부(누락 방지) — FC가 걷어내면 됨.
    if (idx.length === 0) idx = [...faxableIndexes]
    return { insurer: c.name, fileIndexes: idx, neededDocTypes: needed }
  })

  return { fileDocTypes, faxableIndexes, perCompany }
}

// ── 파일 준비 (압축 + base64) ─────────────────────────────────────────────────

const IMG_MAX_DIM = 2200
const IMG_QUALITY = 0.82
const COMPRESS_SKIP_BYTES = 500 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

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

interface PreparedFile {
  blob: Blob
  name: string
  mediaType: string
  ext: string
  data: string
}

async function prepareOne(file: File): Promise<PreparedFile | { error: string }> {
  if (file.type === 'application/pdf') {
    const data = await blobToBase64(file)
    if (!data) return { error: `"${file.name}" 파일이 비어 있습니다.` }
    return { blob: file, name: file.name, mediaType: 'application/pdf', ext: 'pdf', data }
  }
  const isSupported = SUPPORTED_IMAGE_TYPES.has(file.type)
  let blob: Blob = file
  let mediaType = file.type
  if (!(isSupported && file.size <= COMPRESS_SKIP_BYTES)) {
    const jpeg = await reencodeToJpeg(file)
    if (jpeg && !(isSupported && jpeg.size >= file.size)) {
      blob = jpeg
      mediaType = 'image/jpeg'
    } else if (!isSupported) {
      return { error: `"${file.name}" 형식(${file.type || '알 수 없음'})은 지원되지 않습니다. JPG로 저장해 다시 올려주세요.` }
    }
  }
  const data = await blobToBase64(blob)
  if (!data) return { error: `"${file.name}" 파일이 비어 있습니다.` }
  const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/gif' ? 'gif' : mediaType === 'image/webp' ? 'webp' : 'jpg'
  return { blob, name: file.name, mediaType, ext, data }
}

// ── 제출 + 발송 ───────────────────────────────────────────────────────────────

export interface SendFaxInput {
  files: File[]
  /** 발송 대상: 회사명 + files 인덱스(그 회사에 보낼 서류). */
  targets: { insurer: string; fileIndexes: number[] }[]
  customerId?: string | null
  customerName?: string | null
  analysisId?: string | null
  consent: boolean
  note?: string
  /** files[i] 서류종류(감사 기록용) — suggestRouting 의 fileDocTypes. */
  fileDocTypes?: string[]
}

export interface SendFaxResult {
  ok: boolean
  code?: 'NOT_CONFIGURED' | 'NO_FAX_NUMBER'
  error?: string
  submissionId?: string
  results?: { insurer: string; ok: boolean; error?: string }[]
}

/**
 * 서류 준비 → claim-fax 버킷 업로드(감사용) → 제출/대상 insert → send-claim-fax 호출.
 * 설정 전이면 code:'NOT_CONFIGURED' 로 조용히 안내.
 */
export async function createAndSendFax(input: SendFaxInput): Promise<SendFaxResult> {
  if (!input.consent) return { ok: false, error: '고객 청구 위임 확인에 체크해주세요.' }
  const targets = input.targets.filter((t) => t.insurer && t.fileIndexes.length > 0).slice(0, 3)
  if (targets.length === 0) return { ok: false, error: '보낼 보험사와 서류를 1개 이상 선택해주세요.' }

  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const userId = await uid(client)
  if (!userId) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }

  // 1) 파일 준비(압축·인코딩)
  const prepared: PreparedFile[] = []
  for (const f of input.files) {
    const p = await prepareOne(f)
    if ('error' in p) return { ok: false, error: p.error }
    prepared.push(p)
  }

  // 2) 감사용 버킷 업로드 + documents 경로 구성 (best-effort — 버킷 미적용 시 진행)
  const groupId = crypto.randomUUID()
  const paths: string[] = []
  const documents: { path: string; name: string; docType: string }[] = []
  for (let i = 0; i < prepared.length; i += 1) {
    const p = prepared[i]
    const path = `${userId}/${groupId}/${crypto.randomUUID()}.${p.ext}`
    paths.push(path)
    documents.push({ path, name: p.name, docType: input.fileDocTypes?.[i] ?? '기타' })
    try {
      await client.storage.from('claim-fax').upload(path, p.blob, { contentType: p.mediaType, upsert: false })
    } catch {
      /* 버킷 미적용 등 — 전송 자체는 base64로 진행되므로 감사 업로드 실패는 막지 않음 */
    }
  }

  // 3) 제출 insert
  const { data: subRow, error: subErr } = await client
    .from('claim_fax_submissions')
    .insert({
      staff_id: userId,
      customer_id: input.customerId ?? null,
      customer_name: input.customerName ?? null,
      analysis_id: input.analysisId ?? null,
      documents,
      consent: input.consent,
      note: input.note ?? null
    })
    .select('id')
    .single()
  if (subErr || !subRow) {
    if (isMissingSetup(subErr)) return { ok: false, code: 'NOT_CONFIGURED', error: '자동청구 설정 전입니다 (테이블 미적용).' }
    return { ok: false, error: subErr?.message ?? '청구 접수 저장에 실패했습니다.' }
  }
  const submissionId = String((subRow as { id: string }).id)

  // 4) 대상 insert (queued)
  const targetRows = targets.map((t) => ({
    submission_id: submissionId,
    insurer: t.insurer,
    fax: '', // 서버가 insurer_fax 에서 채운다
    file_paths: t.fileIndexes.map((i) => paths[i]).filter(Boolean),
    status: 'queued' as const
  }))
  const { error: tgtErr } = await client.from('claim_fax_targets').insert(targetRows)
  if (tgtErr) return { ok: false, submissionId, error: tgtErr.message ?? '발송 대상 저장에 실패했습니다.' }

  // 5) 엣지 함수 호출
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, submissionId, error: '서버 연결 후 사용할 수 있습니다.' }
  let token = anon
  try {
    const { data } = await client.auth.getSession()
    token = data?.session?.access_token ?? anon
  } catch {
    /* keep anon */
  }

  const filesPayload = paths.map((path, i) => ({
    path,
    name: prepared[i].name,
    mediaType: prepared[i].mediaType,
    data: prepared[i].data
  }))
  const targetsPayload = targets.map((t) => ({
    insurer: t.insurer,
    filePaths: t.fileIndexes.map((i) => paths[i]).filter(Boolean)
  }))

  try {
    const res = await fetch(`${base}/send-claim-fax`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ submissionId, files: filesPayload, targets: targetsPayload })
    })
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; code?: string; error?: string; results?: { insurer: string; ok: boolean; error?: string }[] }
      | null
    if (res.status === 503 && data?.code === 'CLAIM_FAX_NOT_CONFIGURED') {
      return { ok: false, code: 'NOT_CONFIGURED', submissionId, error: data.error ?? '자동청구(팩스) 설정 전입니다.' }
    }
    if (!res.ok || !data?.success) {
      return { ok: false, submissionId, error: String(data?.error ?? `팩스 발송 실패 (HTTP ${res.status})`), results: data?.results }
    }
    return { ok: true, submissionId, results: data.results }
  } catch {
    return { ok: false, submissionId, error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' }
  }
}

/** 발송 상태 조회(상태 칩 갱신용). */
export async function getFaxTargets(submissionId: string): Promise<FaxTargetStatus[]> {
  const client = await getClient()
  if (!client) return []
  const { data, error } = await client.from('claim_fax_targets').select('*').eq('submission_id', submissionId)
  if (error) return []
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: String(r.id),
    insurer: String(r.insurer ?? ''),
    fax: String(r.fax ?? ''),
    filePaths: (r.file_paths as string[] | null) ?? [],
    status: (r.status as FaxTargetStatus['status']) ?? 'queued',
    error: (r.error as string | null) ?? undefined,
    sentAt: (r.sent_at as string | null) ?? undefined
  }))
}
