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

function env(): Record<string, string | undefined> {
  return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {}
}

/**
 * 웹 PWA 배포 안정화용 기본값.
 *
 * SJ INVEST 는 이 Supabase 프로젝트 하나만 사용한다. anon 키는 공개용(프론트엔드에
 * 노출돼도 안전 — 실제 접근 통제는 RLS)이라, 배포 환경변수 누락/오타로 인한 전사 로그인
 * 장애를 막기 위해 코드에 기본값으로 내장한다. 강제 적용은 웹 빌드에서만(vite.config.web.ts
 * 의 __SJ_WEB_BUILD__); 데스크톱/개발 빌드는 기존 env 기반 동작(env 없으면 데모 모드)을 유지한다.
 */
const FALLBACK_SUPABASE_URL = 'https://kmjnluubjgyxkppxxjel.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imttam5sdXViamd5eGtwcHh4amVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNzQ1MjMsImV4cCI6MjA5ODc1MDUyM30.7bCGFTRIx-GwZg7h4V015O1QZnKGKXumeFgqEcvbHPw'

declare const __SJ_WEB_BUILD__: boolean | undefined

/** 웹 PWA 빌드 여부. vite.config.web.ts 에서 define. 그 외 빌드에서는 false. */
function isWebBuild(): boolean {
  try {
    return typeof __SJ_WEB_BUILD__ !== 'undefined' && __SJ_WEB_BUILD__ === true
  } catch {
    return false
  }
}

/** 실제 사용할 Supabase URL. 웹 빌드는 항상 SJ 프로젝트(배포 설정 실수 방지). */
function resolvedSupabaseUrl(): string | undefined {
  if (isWebBuild()) return FALLBACK_SUPABASE_URL
  return env().VITE_SUPABASE_URL?.trim() || undefined
}

/** 실제 사용할 anon 키(공개). 웹 빌드는 항상 내장 기본값. */
function resolvedSupabaseAnonKey(): string | undefined {
  if (isWebBuild()) return FALLBACK_SUPABASE_ANON_KEY
  return env().VITE_SUPABASE_ANON_KEY?.trim() || undefined
}

export interface SupabaseConfigStatus {
  url?: string
  urlConfigured: boolean
  anonKeyConfigured: boolean
  /** True only when BOTH url and anon key are present. */
  isConfigured: boolean
}

/** Read the public Supabase config (no secrets returned). Web build uses built-in defaults. */
export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const url = resolvedSupabaseUrl()
  const anonKey = resolvedSupabaseAnonKey()
  return {
    url,
    urlConfigured: !!url,
    anonKeyConfigured: !!anonKey,
    isConfigured: !!url && !!anonKey
  }
}

/** Public anon key (safe in the frontend). Used as Bearer for Edge Function calls. */
export function getSupabaseAnonKey(): string | undefined {
  return resolvedSupabaseAnonKey()
}

/**
 * Base URL for Supabase Edge Functions, or undefined if unknown. Prefers an explicit
 * VITE_SJ_EDGE_FUNCTION_URL override, else derives `<project-url>/functions/v1`.
 * No secrets — the anon key (public) is sent separately as the Authorization Bearer.
 */
export function getFunctionsBaseUrl(): string | undefined {
  const override = env().VITE_SJ_EDGE_FUNCTION_URL?.trim()
  if (override) return override.replace(/\/+$/, '')
  const url = getSupabaseConfigStatus().url
  return url ? `${url.replace(/\/+$/, '')}/functions/v1` : undefined
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
    // Lazy dynamic import → Vite code-splits @supabase/supabase-js into its own
    // chunk, loaded only when Supabase env is configured (guarded above).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('@supabase/supabase-js')
    const createClient = mod?.createClient
    if (typeof createClient !== 'function') return null
    cachedClient = createClient(resolvedSupabaseUrl(), resolvedSupabaseAnonKey(), {
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
