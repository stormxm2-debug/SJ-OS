import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import type { CustomerAttachment } from '@shared/commercial/models'

/**
 * 고객 첨부(사진·PDF) 저장 — 비공개 버킷 'customer-files'.
 * 경로: <ownerStaffId>/<uuid>.<ext> — 원본 파일명은 attachments 메타(name)에만 저장.
 * 접근은 로그인 직원 한정(스토리지 정책) + 표시할 때 짧은 서명 URL 사용.
 * 파일 내용은 절대 로깅하지 않는다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = 'customer-files'
export const MAX_CUSTOMER_ATTACHMENTS = 5

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

function extOf(file: File): string {
  if (file.type === 'application/pdf') return 'pdf'
  const m = file.name.match(/\.([A-Za-z0-9]{1,5})$/)
  return (m?.[1] ?? 'jpg').toLowerCase()
}

export function attachmentKindOf(file: File): 'image' | 'pdf' | null {
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  return null
}

/** 파일 업로드 → 첨부 메타 반환. 실패 시 error. 10MB 제한. */
export async function uploadCustomerFile(file: File): Promise<{ ok: true; attachment: CustomerAttachment } | { ok: false; error: string }> {
  const kind = attachmentKindOf(file)
  if (!kind) return { ok: false, error: '사진(JPG/PNG) 또는 PDF만 첨부할 수 있습니다.' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: '파일은 10MB 이하여야 합니다.' }
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
  const path = `${uid}/${rand}.${extOf(file)}`
  try {
    const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) return { ok: false, error: '업로드에 실패했습니다. 다시 시도해 주세요.' }
    return { ok: true, attachment: { path, name: file.name.slice(0, 80), kind } }
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
