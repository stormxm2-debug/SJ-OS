import type { ConnectionStatus } from '@shared/commercial/apiContract'

/**
 * Supabase client adapter (renderer-safe).
 *
 * SECURITY: reads ONLY the public config — `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY`. It NEVER reads or uses the service_role key (that must
 * never reach the renderer). No secret is ever logged or returned. When config is
 * missing the app stays in local-mock mode and nothing here throws.
 *
 * The real client is created only after `@supabase/supabase-js` is installed AND
 * env is configured. The package is loaded via a guarded dynamic import so the app
 * builds with zero new dependencies; if the package is absent the import fails
 * safely and the client stays null (local-mock).
 */

// Non-literal specifier + @vite-ignore so the bundler/tsc do not require the
// package to be present. Resolves at runtime only when installed.
const SUPABASE_PKG = '@supabase/supabase-js'

function env(): Record<string, string | undefined> {
  return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {}
}

export interface SupabaseConfigStatus {
  url?: string
  urlConfigured: boolean
  anonKeyConfigured: boolean
  /** True only when BOTH url and anon key are present. */
  isConfigured: boolean
}

/** Read the public Supabase config from env (no secrets returned). */
export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const e = env()
  const url = e.VITE_SUPABASE_URL?.trim() || undefined
  const anonKey = e.VITE_SUPABASE_ANON_KEY?.trim() || undefined
  return {
    url,
    urlConfigured: !!url,
    anonKeyConfigured: !!anonKey,
    isConfigured: !!url && !!anonKey
  }
}

// Cached client (any — the package types are optional/not installed).
let cachedClient: unknown = null
let initTried = false

/**
 * Initialize the Supabase client if configured + package available. Uses the anon
 * public key only; RLS enforces per-row access on the server. Safe to call
 * repeatedly. Returns null when not configured or package missing.
 */
export async function initSupabaseClient(): Promise<unknown | null> {
  if (cachedClient) return cachedClient
  if (initTried) return cachedClient
  initTried = true
  const status = getSupabaseConfigStatus()
  if (!status.isConfigured) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ SUPABASE_PKG)
    const createClient = mod?.createClient
    if (typeof createClient !== 'function') return null
    const e = env()
    cachedClient = createClient(status.url, e.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
    return cachedClient
  } catch {
    // Package not installed / failed to load — stay in local-mock.
    return null
  }
}

/** Cached client (or null). Call initSupabaseClient() first. */
export function getSupabaseClient(): unknown | null {
  return cachedClient
}

/** Back-compat: cached client or null (never throws). */
export function getSupabaseClientOrNull(): unknown | null {
  return cachedClient
}

export interface ConnectionTestResult {
  status: ConnectionStatus
  message: string
}

/** Safe connection test — never writes, never prints secrets/tokens. */
export async function testSupabaseConnection(): Promise<ConnectionTestResult> {
  const status = getSupabaseConfigStatus()
  if (!status.isConfigured) {
    return { status: 'not-configured', message: 'Supabase URL/anon key가 설정되지 않았습니다. 현재 local-mock 모드입니다.' }
  }
  const client = (await initSupabaseClient()) as { auth?: { getSession: () => Promise<{ error?: unknown }> } } | null
  if (!client?.auth) {
    return {
      status: 'unknown',
      message: '@supabase/supabase-js 미설치 또는 클라이언트 미활성화. 설치 후 연결 테스트가 가능합니다.'
    }
  }
  try {
    const { error } = await client.auth.getSession()
    if (error) return { status: 'failed', message: '세션 확인에 실패했습니다. URL/anon key 설정을 확인하세요.' }
    return { status: 'ready', message: 'Supabase 연결이 확인되었습니다. (로그인 후 프로필이 필요합니다)' }
  } catch {
    return { status: 'failed', message: 'Supabase 연결 확인 중 오류가 발생했습니다.' }
  }
}
