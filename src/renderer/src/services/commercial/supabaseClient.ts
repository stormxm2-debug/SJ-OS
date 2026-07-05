import type { ConnectionStatus } from '@shared/commercial/apiContract'

/**
 * Supabase client adapter (renderer-safe).
 *
 * SECURITY: reads ONLY the public config — `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY`. It NEVER reads or uses the service_role key (that must
 * never reach the renderer). No secret is ever logged or returned. When config is
 * missing the app stays in local-mock mode and nothing here throws.
 *
 * The real client is created only after the user installs `@supabase/supabase-js`
 * AND configures env — see getSupabaseClientOrNull() below. Until then this module
 * only reports configuration status; it never contacts a server.
 */

function env(): Record<string, string | undefined> {
  // Defensive access so typecheck passes without vite/client types.
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

/**
 * Returns a Supabase client, or null when not usable.
 *
 * Currently returns null because `@supabase/supabase-js` is not installed. To
 * enable Supabase mode later:
 *   1) npm install @supabase/supabase-js
 *   2) set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public anon key only)
 *   3) replace the body below with:
 *        import { createClient } from '@supabase/supabase-js'
 *        return createClient(status.url!, <anon key>, { auth: { persistSession: true } })
 * The anon key is safe in the renderer; RLS enforces per-row access on the server.
 */
export function getSupabaseClientOrNull(): unknown | null {
  const status = getSupabaseConfigStatus()
  if (!status.isConfigured) return null
  // Package not installed yet — do not attempt to import/bundle it.
  return null
}

export interface ConnectionTestResult {
  status: ConnectionStatus
  message: string
}

/** Safe connection test — never writes, never prints secrets. */
export async function testSupabaseConnection(): Promise<ConnectionTestResult> {
  const status = getSupabaseConfigStatus()
  if (!status.isConfigured) {
    return { status: 'not-configured', message: 'Supabase URL/anon key가 설정되지 않았습니다. 현재 local-mock 모드입니다.' }
  }
  const client = getSupabaseClientOrNull()
  if (!client) {
    return {
      status: 'unknown',
      message: '@supabase/supabase-js 미설치 또는 클라이언트 미활성화. 설치·활성화 후 연결 테스트가 가능합니다.'
    }
  }
  // Future: run a lightweight read-only check (e.g. auth.getSession()) here.
  return { status: 'ready', message: 'Supabase 설정이 감지되었습니다. (실제 연결 검증은 다음 단계에서 활성화)' }
}
