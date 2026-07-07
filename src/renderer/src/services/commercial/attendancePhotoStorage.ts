import { getSupabaseConfigStatus } from './supabaseClient'

/**
 * Attendance photo storage (Supabase Storage, private bucket).
 *
 * Uploads the watermarked photo (a data URL from the camera) to the private
 * `attendance-photos` bucket under the user's auth-uid prefix, and returns ONLY the
 * storage path (never the image bytes). Viewing uses short-lived signed URLs whose
 * access is governed by Storage RLS (owner/admin = all, team-leader = team, else own).
 *
 * SECURITY: anon public client only (never service_role). Never logs raw image/base64.
 * In local-mock mode (no Supabase env) this reports "not configured" and the app keeps
 * the inline data URL for local display instead.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ATTENDANCE_PHOTO_BUCKET = 'attendance-photos'

export interface PhotoUploadResult {
  ok: boolean
  configured: boolean
  path?: string
  message: string
}

/** Photo storage is usable once Supabase is configured (bucket + policies applied). */
export function isAttendancePhotoStorageConfigured(): boolean {
  return getSupabaseConfigStatus().isConfigured
}

/** Parse a `data:image/*;base64,...` URL into a Blob + extension. Never logs data. */
function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string; mime: string } | null {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim())
  if (!match) return null
  const mime = match[1].toLowerCase()
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  try {
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { blob: new Blob([bytes], { type: mime }), ext, mime }
  } catch {
    return null
  }
}

function dayFolder(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function shortId(): string {
  // Renderer app code (not a workflow) — Math.random/Date are fine here.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Upload a watermarked photo to `attendance-photos/<userId>/<yyyy-mm-dd>/<id>.jpg`.
 * The path's first segment MUST be the auth uid (Storage RLS enforces it). Returns
 * the path only; never the bytes. `client` is the Supabase JS client (typed loosely).
 */
export async function uploadAttendancePhoto(client: any, userId: string, dataUrl: string): Promise<PhotoUploadResult> {
  if (!isAttendancePhotoStorageConfigured()) {
    return { ok: false, configured: false, message: '사진 저장소가 설정되지 않았습니다.' }
  }
  if (!client?.storage || !userId) {
    return { ok: false, configured: true, message: '저장소 클라이언트를 사용할 수 없습니다.' }
  }
  const parsed = dataUrlToBlob(dataUrl)
  if (!parsed) {
    return { ok: false, configured: true, message: '사진 형식을 처리할 수 없습니다.' }
  }
  const path = `${userId}/${dayFolder()}/${shortId()}.${parsed.ext}`
  try {
    const { error } = await client.storage
      .from(ATTENDANCE_PHOTO_BUCKET)
      .upload(path, parsed.blob, { contentType: parsed.mime, upsert: false, cacheControl: '3600' })
    if (error) return { ok: false, configured: true, message: '사진 업로드에 실패했습니다.' }
    return { ok: true, configured: true, path, message: '사진이 업로드되었습니다.' }
  } catch {
    return { ok: false, configured: true, message: '사진 업로드 중 오류가 발생했습니다.' }
  }
}

/** Batch-create short-lived signed URLs for viewing. Returns a map path→url (RLS-scoped). */
export async function createSignedPhotoUrls(client: any, paths: string[], expiresSec = 3600): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(paths.filter((p) => !!p)))
  if (!client?.storage || unique.length === 0) return out
  try {
    const { data } = await client.storage.from(ATTENDANCE_PHOTO_BUCKET).createSignedUrls(unique, expiresSec)
    if (Array.isArray(data)) {
      for (const item of data as Array<{ path?: string; signedUrl?: string; error?: unknown }>) {
        if (item?.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl)
      }
    }
  } catch {
    /* leave empty — records simply render without a thumbnail */
  }
  return out
}
