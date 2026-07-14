import { getSupabaseClient, initSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'

/**
 * 자료실 (shared_files + shared-files 버킷).
 *
 * - 공유(company): 전 직원 열람, 대표·관리자만 업로드/삭제.
 * - 개인(personal): 올린 본인만 열람/관리. **대표(관리자)는 전 회원 개인 파일을 열람·관리
 *   할 수 있다** (오버사이트). 삭제는 소프트삭제(서버 보존) — 회원 화면에선 사라지지만
 *   대표는 '삭제됨(보관)'에서 계속 보고 복원·영구삭제할 수 있다. 영구삭제는 대표만.
 * 파일 원본은 비공개 버킷에, 목록 메타데이터는 shared_files 테이블에 저장.
 * 열람은 1시간짜리 서명 URL — 링크가 새어도 만료되면 무효.
 *
 * SECURITY: anon public client only (never service_role). RLS가 실제 경계.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = 'shared-files'

export type SharedFileScope = 'company' | 'personal'
/** 개인함 뷰: 활성(기본) / 삭제됨(대표만 — 소프트삭제 보관함). */
export type SharedFileView = 'active' | 'deleted'

export interface SharedFileItem {
  id: string
  scope: SharedFileScope
  ownerId: string
  ownerName: string
  name: string
  path: string
  mime?: string
  sizeBytes: number
  createdAt: string
  /** 소프트삭제 시각 (null = 활성). */
  deletedAt?: string | null
  /** 삭제 주체 라벨: 'member'(회원) | 'owner'(대표). */
  deletedByRole?: string | null
}

export const SHARED_FILE_MAX_BYTES = 20 * 1024 * 1024

/** 문서 전반 (대표 선택): PDF·이미지·오피스·한글·텍스트. */
const ALLOWED_EXTS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'xlsx',
  'xls',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'hwp',
  'txt',
  'csv'
])

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : ''
}

export function isAllowedSharedFile(fileName: string): boolean {
  return ALLOWED_EXTS.has(extOf(fileName))
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function currentUid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

function mapRow(r: Record<string, unknown>): SharedFileItem {
  return {
    id: String(r.id),
    scope: (r.scope as SharedFileScope) ?? 'personal',
    ownerId: String(r.owner_id ?? ''),
    ownerName: String(r.owner_name ?? ''),
    name: String(r.name ?? '파일'),
    path: String(r.path ?? ''),
    mime: (r.mime as string | null) ?? undefined,
    sizeBytes: Number(r.size_bytes ?? 0),
    createdAt: String(r.created_at ?? ''),
    deletedAt: (r.deleted_at as string | null) ?? null,
    deletedByRole: (r.deleted_by_role as string | null) ?? null
  }
}

const NOT_CONFIGURED = '서버 연결 후 사용할 수 있습니다.'
const NOT_READY = '자료실 준비 중입니다 — 관리자에게 문의해 주세요. (DB 스키마 미적용)'

export async function listSharedFiles(
  scope: SharedFileScope,
  view: SharedFileView = 'active'
): Promise<{ ok: boolean; items: SharedFileItem[]; error?: string }> {
  if (!getSupabaseConfigStatus().isConfigured) return { ok: false, items: [], error: NOT_CONFIGURED }
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: NOT_CONFIGURED }
  if (!(await currentUid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    let q = client.from('shared_files').select('*').eq('scope', scope)
    // 활성=삭제 안 된 것(회원·대표 공통 기본), 삭제됨=대표 보관함(소프트삭제분).
    q = view === 'deleted' ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) return { ok: false, items: [], error: NOT_READY }
    return { ok: true, items: ((data ?? []) as Record<string, unknown>[]).map(mapRow) }
  } catch {
    return { ok: false, items: [], error: '파일 목록을 불러오지 못했습니다.' }
  }
}

/** 저장 키는 ASCII로 정제 (한글 파일명은 DB name 컬럼에 원본 보존). */
function safeKeyName(fileName: string): string {
  const ext = extOf(fileName)
  const base = fileName
    .slice(0, fileName.length - (ext ? ext.length + 1 : 0))
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 40)
  return `${base || 'file'}${ext ? `.${ext}` : ''}`
}

export async function uploadSharedFile(
  file: File,
  scope: SharedFileScope,
  ownerName: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isAllowedSharedFile(file.name)) return { ok: false, error: `${file.name}: 지원하지 않는 형식입니다.` }
  if (file.size > SHARED_FILE_MAX_BYTES) return { ok: false, error: `${file.name}: 20MB를 초과합니다.` }
  const client = await getClient()
  if (!client) return { ok: false, error: NOT_CONFIGURED }
  const uid = await currentUid(client)
  if (!uid) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }

  const id = crypto.randomUUID()
  const path = scope === 'company' ? `company/${id}-${safeKeyName(file.name)}` : `${uid}/${id}-${safeKeyName(file.name)}`
  try {
    const { error: upErr } = await client.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false, cacheControl: '3600' })
    if (upErr) return { ok: false, error: `${file.name}: 업로드에 실패했습니다.` }

    const { error: rowErr } = await client.from('shared_files').insert({
      id,
      scope,
      owner_id: uid,
      owner_name: ownerName,
      name: file.name,
      path,
      mime: file.type || null,
      size_bytes: file.size
    })
    if (rowErr) {
      // 목록에 없는 고아 파일이 남지 않게 원본도 정리
      void client.storage.from(BUCKET).remove([path])
      return { ok: false, error: `${file.name}: 등록에 실패했습니다.` }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: `${file.name}: 업로드 중 오류가 발생했습니다.` }
  }
}

/**
 * 소프트삭제 — 개인 파일을 '삭제됨'으로 표시(서버 보존). 회원 화면에선 사라지지만
 * 대표는 보관함에서 계속 본다. asOwner=대표가 지운 경우(라벨용). RLS: 회원=본인 활성분,
 * 대표=전체.
 */
export async function softDeleteFile(item: SharedFileItem, asOwner: boolean): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: NOT_CONFIGURED }
  const uid = await currentUid(client)
  try {
    const { error } = await client
      .from('shared_files')
      .update({ deleted_at: new Date().toISOString(), deleted_by: uid, deleted_by_role: asOwner ? 'owner' : 'member' })
      .eq('id', item.id)
    if (error) return { ok: false, error: '삭제 권한이 없거나 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
  }
}

/** 복원 — 소프트삭제된 파일을 다시 활성으로 (대표만, RLS 강제). */
export async function restoreFile(item: SharedFileItem): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: NOT_CONFIGURED }
  try {
    const { error } = await client
      .from('shared_files')
      .update({ deleted_at: null, deleted_by: null, deleted_by_role: null })
      .eq('id', item.id)
    if (error) return { ok: false, error: '복원 권한이 없거나 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '복원 중 오류가 발생했습니다.' }
  }
}

/**
 * 영구삭제 — DB 행 + 원본까지 완전히 제거 (되돌릴 수 없음). RLS상 대표/관리자만
 * (개인 파일 하드삭제는 대표만). 공유(company) 자료의 관리자 삭제에도 사용.
 */
export async function deleteSharedFile(item: SharedFileItem): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: NOT_CONFIGURED }
  try {
    const { error } = await client.from('shared_files').delete().eq('id', item.id)
    if (error) return { ok: false, error: '삭제 권한이 없거나 실패했습니다.' }
    void client.storage.from(BUCKET).remove([item.path])
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
  }
}

/** 열람용 서명 URL (1시간). RLS로 접근 가능한 파일만 발급된다. */
export async function sharedFileUrl(item: SharedFileItem): Promise<{ ok: boolean; url?: string; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: NOT_CONFIGURED }
  try {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(item.path, 3600)
    if (error || !data?.signedUrl) return { ok: false, error: '파일 링크 생성에 실패했습니다.' }
    return { ok: true, url: data.signedUrl as string }
  } catch {
    return { ok: false, error: '파일 링크 생성 중 오류가 발생했습니다.' }
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}
