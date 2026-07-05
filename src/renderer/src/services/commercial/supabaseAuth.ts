import type { StaffRole } from '@shared/commercial/models'
import { getSupabaseConfigStatus, getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase Auth + profile-role service.
 *
 * SECURITY: uses the anon public client only (never service_role). It never logs or
 * returns tokens/passwords/raw session objects. Profile role is read from
 * public.profiles and validated before any app access. All calls are safe no-ops
 * (return a clear result) when Supabase is not configured.
 */

const ALLOWED_ROLES: StaffRole[] = ['owner', 'admin', 'team-leader', 'fc']

export interface SupabaseProfile {
  id: string
  name: string
  role: StaffRole
  teamId?: string
  phone?: string
  email?: string
  status: string
}

export type AuthResolution =
  | { state: 'not-configured' }
  | { state: 'logged-out' }
  | { state: 'profile-missing'; message: string }
  | { state: 'blocked'; message: string }
  | { state: 'ok'; profile: SupabaseProfile }

export interface SignInResult {
  ok: boolean
  message?: string
}

/** Minimal structural view of the client (avoids requiring package types). */
interface SupaClient {
  auth: {
    getSession: () => Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>
    signInWithPassword: (c: { email?: string; phone?: string; password: string }) => Promise<{ data: unknown; error: { message?: string } | null }>
    signOut: () => Promise<{ error: unknown }>
    onAuthStateChange: (cb: () => void) => { data: { subscription: { unsubscribe: () => void } } }
  }
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> }
    }
  }
}

async function client(): Promise<SupaClient | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as SupaClient | null) ?? null
}

export function isSupabaseAuthConfigured(): boolean {
  return getSupabaseConfigStatus().isConfigured
}

/** Sign in with email/password. Never logs the password. */
export async function signInWithEmailPassword(email: string, password: string): Promise<SignInResult> {
  const c = await client()
  if (!c) return { ok: false, message: 'Supabase 설정이 없습니다.' }
  if (!email.trim() || !password) return { ok: false, message: '이메일/비밀번호를 확인해주세요.' }
  try {
    const { error } = await c.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { ok: false, message: '이메일/비밀번호를 확인해주세요.' }
    return { ok: true }
  } catch {
    return { ok: false, message: '로그인 처리 중 오류가 발생했습니다.' }
  }
}

/** Sign in with phone + password (admin-managed phone login). Never logs values. */
export async function signInWithPhonePassword(normalizedPhone: string, password: string): Promise<SignInResult> {
  const c = await client()
  if (!c) return { ok: false, message: 'Supabase 설정이 없습니다.' }
  if (!normalizedPhone || !password) return { ok: false, message: '휴대폰 번호 또는 비밀번호를 확인해주세요.' }
  try {
    const { error } = await c.auth.signInWithPassword({ phone: normalizedPhone, password })
    // Never reveal whether the phone exists.
    if (error) return { ok: false, message: '휴대폰 번호 또는 비밀번호를 확인해주세요.' }
    return { ok: true }
  } catch {
    return { ok: false, message: '로그인 처리 중 오류가 발생했습니다.' }
  }
}

/** Optional Edge Function base URL (server-side account claim/reset). No secret. */
export function getEdgeFunctionBase(): string | undefined {
  const e = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {}
  return e.VITE_SJ_EDGE_FUNCTION_URL?.trim() || undefined
}

export async function signOut(): Promise<void> {
  const c = await client()
  try {
    await c?.auth.signOut()
  } catch {
    /* ignore — session cleared client-side regardless */
  }
}

/** Load the profile row for a given auth user id (RLS-scoped, anon client). */
async function loadProfile(userId: string): Promise<SupabaseProfile | null> {
  const c = await client()
  if (!c) return null
  try {
    const { data } = await c
      .from('profiles')
      .select('id, name, role, team_id, phone, email, status')
      .eq('id', userId)
      .maybeSingle()
    if (!data) return null
    const row = data as Record<string, unknown>
    return {
      id: String(row.id),
      name: String(row.name ?? ''),
      role: row.role as StaffRole,
      teamId: (row.team_id as string | null) ?? undefined,
      phone: (row.phone as string | null) ?? undefined,
      email: (row.email as string | null) ?? undefined,
      status: String(row.status ?? 'inactive')
    }
  } catch {
    return null
  }
}

/** Resolve the current session → validated profile → app role. */
export async function resolveSessionAndProfile(): Promise<AuthResolution> {
  if (!isSupabaseAuthConfigured()) return { state: 'not-configured' }
  const c = await client()
  if (!c) return { state: 'not-configured' }
  let userId: string | null = null
  try {
    const { data } = await c.auth.getSession()
    userId = data.session?.user?.id ?? null
  } catch {
    return { state: 'logged-out' }
  }
  if (!userId) return { state: 'logged-out' }

  const profile = await loadProfile(userId)
  if (!profile) {
    return {
      state: 'profile-missing',
      message: '로그인은 성공했지만 직원 프로필이 없습니다. Supabase profiles 테이블에 직원 프로필을 생성해야 합니다.'
    }
  }
  if (profile.status !== 'active') {
    return { state: 'blocked', message: '비활성 직원 계정입니다. 관리자에게 문의하세요.' }
  }
  if (!ALLOWED_ROLES.includes(profile.role)) {
    return { state: 'blocked', message: '허용되지 않은 직원 권한입니다. 관리자에게 문의하세요.' }
  }
  return { state: 'ok', profile }
}

/** Subscribe to auth state changes; returns an unsubscribe function. */
export function onAuthStateChange(callback: () => void): () => void {
  let unsub = (): void => {}
  void (async () => {
    const c = await client()
    if (!c) return
    try {
      const { data } = c.auth.onAuthStateChange(() => callback())
      unsub = () => data.subscription.unsubscribe()
    } catch {
      /* ignore */
    }
  })()
  return () => unsub()
}
