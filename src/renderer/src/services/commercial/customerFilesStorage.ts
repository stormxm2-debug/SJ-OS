import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import type { CustomerAttachment } from '@shared/commercial/models'
import { MAX_CUSTOMER_ATTACHMENTS } from './customerValidation'

/**
 * 고객 첨부(사진·PDF·음성) 저장 — 비공개 버킷 'customer-files'.
 * 경로: <ownerStaffId>/<uuid>.<ext> — 원본 파일명은 attachments 메타(name)에만 저장.
 * 접근은 로그인 직원 한정(스토리지 정책) + 표시할 때 짧은 서명 URL 사용.
 * 음성(통화·상담 녹취)은 추후 고객 민원 대응 증거용 — uploadedAt을 함께 기록한다.
 * 파일 내용은 절대 로깅하지 않는다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = 'customer-files'
export { MAX_CUSTOMER_ATTACHMENTS }

/** 폰 통화녹음 앱이 내는 확장자 포함 — 브라우저가 MIME을 못 채우는 경우(amr 등) 대비. */
const AUDIO_EXTS = ['m4a', 'mp3', 'wav', 'aac', 'amr', 'ogg', 'oga', 'webm', '3gp', 'wma', 'flac'] as const
const AUDIO_EXT_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  amr: 'audio/amr',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  webm: 'audio/webm',
  '3gp': 'audio/3gpp',
  wma: 'audio/x-ms-wma',
  flac: 'audio/flac'
}

const MAX_FILE_MB = 10
/** 통화 녹음은 길면 수십 MB — 오디오만 별도 상한. */
const MAX_AUDIO_MB = 50

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

function fileExt(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]{1,5})$/)
  return (m?.[1] ?? '').toLowerCase()
}

function extOf(file: File): string {
  if (file.type === 'application/pdf') return 'pdf'
  const named = fileExt(file.name)
  if (named) return named
  if (file.type.startsWith('audio/')) {
    const found = Object.entries(AUDIO_EXT_MIME).find(([, mime]) => mime === file.type)
    return found?.[0] ?? 'm4a'
  }
  return 'jpg'
}

export function attachmentKindOf(file: File): 'image' | 'pdf' | 'audio' | null {
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  // 폰 녹음 파일(amr·3gp 등)은 MIME이 비어 오는 경우가 있어 확장자로 보조 판정
  if ((!file.type || file.type === 'application/octet-stream') && (AUDIO_EXTS as readonly string[]).includes(fileExt(file.name))) return 'audio'
  return null
}

/** 파일 업로드 → 첨부 메타 반환. 실패 시 error. 사진·PDF 10MB / 음성 50MB 제한. */
export async function uploadCustomerFile(file: File): Promise<{ ok: true; attachment: CustomerAttachment } | { ok: false; error: string }> {
  const kind = attachmentKindOf(file)
  if (!kind) return { ok: false, error: '사진(JPG/PNG), PDF 또는 음성 파일만 첨부할 수 있습니다.' }
  const maxMb = kind === 'audio' ? MAX_AUDIO_MB : MAX_FILE_MB
  if (file.size > maxMb * 1024 * 1024) return { ok: false, error: `${kind === 'audio' ? '음성 파일은' : '파일은'} ${maxMb}MB 이하여야 합니다.` }
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 첨부할 수 있습니다.' }
  let uid = ''
  try {
    const { data } = await client.auth.getSession()
    uid = data?.session?.user?.id ?? ''
  } catch {
    uid = ''
  }
  if (!uid) return { ok: false, error: '로그인 후 첨부할 수 있습니다.' }
  const rand = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? String(Date.now())
  const ext = extOf(file)
  const path = `${uid}/${rand}.${ext}`
  const contentType = file.type || AUDIO_EXT_MIME[ext] || 'application/octet-stream'
  try {
    const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType, upsert: false })
    if (error) return { ok: false, error: '업로드에 실패했습니다. 다시 시도해 주세요.' }
    return { ok: true, attachment: { path, name: file.name.slice(0, 80), kind, uploadedAt: new Date().toISOString() } }
  } catch {
    return { ok: false, error: '업로드 중 오류가 발생했습니다.' }
  }
}

/** 첨부 경로들의 서명 URL(1시간). 실패한 항목은 빠짐. */
export async function signedUrlsFor(attachments: CustomerAttachment[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (attachments.length === 0) return out
  const client = await getClient()
  if (!client) return out
  try {
    const { data } = await client.storage.from(BUCKET).createSignedUrls(attachments.map((a) => a.path), 3600)
    for (const item of (data as { path: string | null; signedUrl: string | null }[] | null) ?? []) {
      if (item.path && item.signedUrl) out.set(item.path, item.signedUrl)
    }
  } catch {
    /* 표시용 — 실패해도 치명적이지 않음 */
  }
  return out
}

/** 첨부 삭제 (고객 저장 후 정리용 — 실패해도 무시). */
export async function deleteCustomerFile(path: string): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    await client.storage.from(BUCKET).remove([path])
  } catch {
    /* ignore */
  }
}
