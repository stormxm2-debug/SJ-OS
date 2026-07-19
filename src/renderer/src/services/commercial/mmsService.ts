import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 고객에게 사진 문자(MMS) 발송. 카카오 친구추가·템플릿 심사 없이 아무 고객에게
 * 텍스트+사진 발송(문자로 도착). 이미지는 MMS 규격(~200KB JPEG)으로 이 기기에서
 * 자동 압축 후 base64로 서버(send-mms)에 전달 → 솔라피가 발송. 목적지 번호는
 * 서버가 RLS 범위에서 조회한다(클라가 번호를 보내지 않음).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** MMS 이미지 목표 용량(base64 문자수) — 약 200KB. */
const TARGET_B64 = 270_000
const MAX_DIM = 1280

async function bearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as { auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> } } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(new Error('read'))
    r.readAsDataURL(blob)
  })
}

/** 캔버스로 JPEG 재인코딩 (dim/quality 조절). */
async function encodeJpeg(file: File, maxDim: number, quality: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file)
    try {
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * scale))
      const h = Math.max(1, Math.round(bmp.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bmp, 0, 0, w, h)
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    } finally {
      bmp.close()
    }
  } catch {
    return null
  }
}

/** MMS 규격에 맞게 반복 압축 → base64. 실패 시 null. */
async function prepareImage(file: File): Promise<string | null> {
  const steps: { dim: number; q: number }[] = [
    { dim: MAX_DIM, q: 0.72 },
    { dim: 1024, q: 0.66 },
    { dim: 900, q: 0.6 },
    { dim: 760, q: 0.52 },
    { dim: 640, q: 0.45 }
  ]
  for (const s of steps) {
    const blob = await encodeJpeg(file, s.dim, s.q)
    if (!blob) continue
    const b64 = await blobToBase64(blob)
    if (b64 && b64.length <= TARGET_B64) return b64
  }
  // 마지막 시도값이라도 반환(서버가 상한 초과면 413)
  const last = await encodeJpeg(file, 600, 0.4)
  return last ? await blobToBase64(last) : null
}

export interface SendMmsResult {
  ok: boolean
  code?: 'NOT_CONFIGURED'
  error?: string
}

export async function sendCustomerMms(input: { customerId: string; text: string; imageFile: File; subject?: string }): Promise<SendMmsResult> {
  if (!input.text.trim()) return { ok: false, error: '메시지 내용을 입력해주세요.' }
  if (!input.imageFile) return { ok: false, error: '사진을 첨부해주세요.' }
  if (!input.imageFile.type.startsWith('image/')) return { ok: false, error: '이미지 파일만 첨부할 수 있습니다.' }

  const image = await prepareImage(input.imageFile)
  if (!image) return { ok: false, error: '사진을 처리하지 못했습니다. 다른 사진으로 시도해주세요.' }

  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const token = (await bearer()) ?? anon

  try {
    const res = await fetch(`${base}/send-mms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ customerId: input.customerId, text: input.text.trim(), image, subject: input.subject })
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; code?: string; error?: string } | null
    if (res.status === 503 && data?.code === 'MMS_NOT_CONFIGURED') {
      return { ok: false, code: 'NOT_CONFIGURED', error: data.error ?? '사진 문자(MMS) 설정 전입니다.' }
    }
    if (!res.ok || !data?.success) return { ok: false, error: String(data?.error ?? `발송 실패 (HTTP ${res.status})`) }
    return { ok: true }
  } catch {
    return { ok: false, error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' }
  }
}
