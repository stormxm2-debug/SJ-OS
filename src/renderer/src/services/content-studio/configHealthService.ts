import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * 서버 설정(시크릿) 상태 조회 — config-health edge function.
 * 각 외부 연동 키의 '등록 여부'만 받아온다(값은 서버가 반환하지 않음). 대표·관리자 전용.
 */

export interface ConfigHealth {
  present: Record<string, boolean>
  groups: Record<string, boolean>
}

export interface ConfigHealthResult {
  ok: boolean
  data?: ConfigHealth
  error?: string
  notConfigured?: boolean
}

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

export async function fetchConfigHealth(): Promise<ConfigHealthResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, notConfigured: true, error: '서버 연결 후 사용할 수 있습니다.' }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/config-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: '{}',
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; present?: Record<string, boolean>; groups?: Record<string, boolean> } | null
    if (res.status === 404) return { ok: false, notConfigured: true, error: '설정 점검 기능 배포 전입니다.' }
    if (res.status === 403) return { ok: false, error: '대표·관리자만 확인할 수 있습니다.' }
    if (!res.ok || !data?.ok || !data.present) return { ok: false, error: data?.error || '설정 상태를 불러오지 못했습니다.' }
    return { ok: true, data: { present: data.present, groups: data.groups ?? {} } }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '요청 시간 초과 — 다시 시도해 주세요.' : '설정 상태 조회 중 오류가 발생했습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}
