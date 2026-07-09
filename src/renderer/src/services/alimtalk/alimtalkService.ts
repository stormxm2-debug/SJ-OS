import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'

/**
 * 알림톡(카카오 비즈메시지) 발송 — send-alimtalk edge function 호출.
 *
 * 전화번호는 클라이언트를 거치지 않는다: scheduleId만 보내면 서버가 일정→고객
 * 연락처를 직접 조회해 발송한다 (본인 일정 또는 관리자만 허용).
 * 솔라피 키가 등록되기 전에는 서버가 ALIMTALK_NOT_CONFIGURED를 반환하고,
 * UI는 "설정 전" 안내만 보여준다 — 앱은 계속 정상 동작.
 */

export type AlimtalkKind = 'confirm' | 'reminder' | 'change'

/** Edge Function 인증: 로그인 세션 토큰(없으면 anon). 값은 절대 로깅하지 않음. */
async function functionsBearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

export interface AlimtalkResult {
  ok: boolean
  /** 사용자에게 그대로 보여줄 한국어 메시지. */
  message: string
  notConfigured?: boolean
}

export async function sendMeetingAlimtalk(scheduleId: string, kind: AlimtalkKind): Promise<AlimtalkResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, message: '서버 연결 후 사용할 수 있습니다.' }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/send-alimtalk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scheduleId, kind }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string } | null
    if (res.ok && data?.success) return { ok: true, message: '고객에게 카톡 안내를 보냈습니다.' }
    const notConfigured = data?.code === 'ALIMTALK_NOT_CONFIGURED'
    return {
      ok: false,
      notConfigured,
      message: notConfigured
        ? '알림톡 설정 전입니다 — 옆의 공유 버튼으로 보내주세요.'
        : data?.error || '발송에 실패했습니다. 잠시 후 다시 시도해 주세요.'
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, message: aborted ? '발송 시간 초과. 다시 시도해 주세요.' : '발송 중 오류가 발생했습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}
