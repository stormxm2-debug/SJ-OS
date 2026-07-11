import { getSupabaseClient, initSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'

/**
 * 자료실 (shared_files + shared-files 버킷).
 *
 * - 공유(company): 전 직원 열람, 대표·관리자만 업로드/삭제.
 * - 개인(personal): 올린 본인만 열람/삭제 — 관리자도 못 본다 ("자기만" 원칙, RLS 강제).
 * 파일 원본은 비공개 버킷에, 목록 메타데이터는 shared_files 테이블에 저장.
 * 열람은 1시간짜리 서명 URL — 링크가 새어도 만료되면 무효.
 *
 * SECURITY: anon public client only (never service_role). RLS가 실제 경계.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = 'shared-files'

export type SharedFileScope = 'company' | 'personal'

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
    createdAt: String(r.created_at ?? '')
  }
}

const NOT_CONFIGURED = '서버 연결 후 사용할 수 있습니다.'
const NOT_READY = '자료실 준비 중입니다 — 관리자에게 문의해 주세요. (DB 스키마 미적용)'

export async function listSharedFiles(scope: SharedFileScope): Promise<{ ok: boolean; items: SharedFileItem[]; error?: string }> {
  if (!getSupabaseConfigStatus().isConfigured) return { ok: false, items: [], error: NOT_CONFIGURED }
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: NOT_CONFIGURED }
  if (!(await currentUid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client.from('shared_files').select('*').eq('scope', scope).order('created_at', { ascending: false })
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
