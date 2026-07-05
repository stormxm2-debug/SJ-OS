/**
 * Attendance photo storage scaffold (DEFERRED).
 *
 * Supabase Storage upload is intentionally NOT implemented in this sprint. This
 * scaffold reports "not configured" so attendance records save without a photo, and
 * documents the safe future path. It NEVER logs or returns raw image/base64 data,
 * NEVER uses the service_role key, and NEVER uploads until a bucket + storage
 * policies are verified.
 *
 * Future: with `@supabase/supabase-js` + a private `attendance-photos` bucket +
 * storage policies, upload via `client.storage.from(BUCKET).upload(path, blob)` and
 * store only the returned path (photo_path) — never the image bytes.
 */

export const ATTENDANCE_PHOTO_BUCKET = 'attendance-photos'

export interface PhotoUploadResult {
  ok: boolean
  configured: boolean
  path?: string
  message: string
}

/** Whether photo storage is usable. Deferred this sprint → always false. */
export function isAttendancePhotoStorageConfigured(): boolean {
  return false
}

/** Deferred: never uploads. Returns a clear, secret-free not-configured result. */
export async function uploadAttendancePhoto(): Promise<PhotoUploadResult> {
  return {
    ok: false,
    configured: false,
    message: '사진 저장소가 설정되지 않아 출퇴근 기록만 저장됩니다.'
  }
}
