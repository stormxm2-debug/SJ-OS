import { getFunctionsBaseUrl, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * OTP 전달 시스템 — 보험사 전산 로그인 인증번호를 폰 앱이 자동 수신 → 총무 보드에 실시간 표시.
 *
 * - FC: 기기 토큰을 발급받아 폰 포워더 앱에 1회 등록(이후 자동).
 * - 총무/관리자: otp_codes 실시간 구독으로 수신 코드 즉시 확인.
 * 코드는 3분 후 만료(expires_at). 내부 전용.
 */

export interface OtpDevice {
  id: string
  token: string
  label: string | null
  active: boolean
  last_used_at: string | null
}

export interface OtpCode {
  id: string
  staff_id: string
  insurer: string | null
  code: string
  sender: string | null
  created_at: string
  expires_at: string
  staffName?: string
}

function genToken(): string {
  const a = new Uint8Array(24)
  crypto.getRandomValues(a)
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Client = {
  auth: { getUser: () => Promise<{ data?: { user?: { id?: string } } }> }
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  channel: (n: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  removeChannel: (c: unknown) => void
}

async function client(): Promise<Client | null> {
  try {
    await initSupabaseClient()
    return (getSupabaseClient() as unknown as Client) ?? null
  } catch {
    return null
  }
}

/** 포워더 앱이 POST 할 수신 엔드포인트 URL. */
export function ingestUrl(): string {
  const base = getFunctionsBaseUrl()
  return base ? `${base}/otp-ingest` : ''
}

/** 내 활성 기기 토큰을 가져오거나(없으면) 새로 만든다. */
export async function getOrCreateMyDevice(label = '내 폰'): Promise<OtpDevice | null> {
  const c = await client()
  if (!c) return null
  const uid = (await c.auth.getUser()).data?.user?.id
  if (!uid) return null
  const existing = await c.from('otp_devices').select('id, token, label, active, last_used_at').eq('staff_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1)
  const row = existing.data?.[0] as OtpDevice | undefined
  if (row) return row
  const ins = await c.from('otp_devices').insert({ staff_id: uid, token: genToken(), label }).select('id, token, label, active, last_used_at').single()
  return (ins.data as OtpDevice) ?? null
}

/** 내 기기 토큰 재발급(기존 비활성화 후 새로 생성). */
export async function regenerateMyDevice(label = '내 폰'): Promise<OtpDevice | null> {
  const c = await client()
  if (!c) return null
  const uid = (await c.auth.getUser()).data?.user?.id
  if (!uid) return null
  await c.from('otp_devices').update({ active: false }).eq('staff_id', uid)
  const ins = await c.from('otp_devices').insert({ staff_id: uid, token: genToken(), label }).select('id, token, label, active, last_used_at').single()
  return (ins.data as OtpDevice) ?? null
}

/** 최근 수신 코드 (총무 보드=전체 / FC=본인). 만료 안 된 것 우선. */
export async function listRecentCodes(limit = 30): Promise<OtpCode[]> {
  const c = await client()
  if (!c) return []
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const res = await c
    .from('otp_codes')
    .select('id, staff_id, insurer, code, sender, created_at, expires_at, staff:profiles(name)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = (res.data as Array<OtpCode & { staff?: { name?: string } }>) ?? []
  return rows.map((r) => ({ ...r, staffName: r.staff?.name }))
}

/** otp_codes INSERT 실시간 구독. 반환된 해제 함수를 호출해 구독 종료. */
export function subscribeCodes(onInsert: (row: OtpCode) => void): () => void {
  let channel: unknown = null
  let cancelled = false
  void client().then((c) => {
    if (!c || cancelled) return
    channel = c
      .channel('otp_codes_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'otp_codes' }, (payload: { new: OtpCode }) => onInsert(payload.new))
      .subscribe()
  })
  return () => {
    cancelled = true
    void client().then((c) => {
      if (c && channel) c.removeChannel(channel)
    })
  }
}
