import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * 웹 푸시 — 앱(브라우저)을 닫아도 PC·폰 OS 알림이 오도록 구독을 만들고 서버에 저장한다.
 * - 알림 권한이 '허용'인 기기에서만 동작한다(권한 요청은 '알림 켜기' 버튼이 담당).
 * - 공개키는 공개돼도 되는 값. 비밀키는 서버(edge function 시크릿)에만 있다.
 * - 발송은 push-send edge function 이 맡는다. 클라이언트는 이벤트만 알린다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const WEB_PUSH_PUBLIC_KEY = 'BLLgDCT6IbTSWj4bH4k2i3OG1OP-rGTOsJTqw7WhxJ2SNd6kNq1i6p2xh7eotbUegrW2iboJ7d5bGlpmrpAHdsM'

export type RegistrationPushKind = 'new' | 'memo' | 'done' | 'rejected'

function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function webPushSupported(): boolean {
  try {
    return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
  } catch {
    return false
  }
}

/**
 * 알림 권한이 허용된 상태에서 이 기기의 푸시 구독을 만들고 서버에 저장한다.
 * 권한이 없거나 지원되지 않으면 아무 일도 하지 않는다(업무 동작에는 영향 없음).
 */
export async function ensureWebPushSubscription(): Promise<{ ok: boolean; reason?: string }> {
  if (!webPushSupported()) return { ok: false, reason: 'unsupported' }
  if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(WEB_PUSH_PUBLIC_KEY) })
    }
    await initSupabaseClient()
    const client = getSupabaseClient() as any
    const { data } = (await client?.auth?.getSession()) ?? { data: null }
    const uid: string | undefined = data?.session?.user?.id
    if (!uid) return { ok: false, reason: 'login' }
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, reason: 'subscription' }
    const { error } = await client
      .from('push_subscriptions')
      .upsert(
        {
          user_id: uid,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent.slice(0, 200),
          last_seen_at: new Date().toISOString()
        },
        { onConflict: 'endpoint' }
      )
    if (error) return { ok: false, reason: 'save' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** 고객등록 이벤트 알림 발송 요청. 실패해도 업무 흐름은 막지 않는다. */
export async function sendRegistrationPush(registrationId: string, kind: RegistrationPushKind): Promise<void> {
  try {
    const base = getFunctionsBaseUrl()
    const anon = getSupabaseAnonKey()
    if (!base || !anon || !registrationId) return
    await initSupabaseClient()
    const client = getSupabaseClient() as any
    const { data } = (await client?.auth?.getSession()) ?? { data: null }
    const token: string = data?.session?.access_token ?? anon
    void fetch(`${base}/push-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ registrationId, kind })
    }).catch(() => undefined)
  } catch {
    /* 알림 실패는 무시 */
  }
}
