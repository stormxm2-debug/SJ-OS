import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEMO_USERS, type DemoUser, type UserRole } from './roleAccess'
import type { AuthMode } from '@shared/commercial/apiContract'
import { getSupabaseConfigStatus } from '@renderer/services/commercial/supabaseClient'
import {
  onAuthStateChange,
  resolveSessionAndProfile,
  signInWithEmailPassword,
  signOut as supabaseSignOut
} from '@renderer/services/commercial/supabaseAuth'

/**
 * Session shell for both auth modes.
 *
 * - local-demo (default, no Supabase env): the existing demo login shell — owner
 *   pre-logged-in, role switcher, logout. Unchanged behavior.
 * - supabase-auth (only when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set):
 *   real Supabase Auth email/password login; the app role comes from the user's
 *   public.profiles row. Never stores/logs tokens or the service_role key.
 *
 * The role exposed here drives all role-based menu visibility + route guards.
 */

export interface UserSession {
  id: string
  name: string
  role: UserRole
  teamName?: string
  position?: string
  isLoggedIn: boolean
  lastLoginAt?: string
}

export type AuthUiState = 'loading' | 'logged-out' | 'logged-in' | 'profile-missing' | 'blocked'

interface SessionValue {
  session: UserSession
  authMode: AuthMode
  supabaseConfigured: boolean
  authState: AuthUiState
  authError?: string
  login: (user: DemoUser) => void
  logout: () => void
  switchUser: (userId: string) => void
  supabaseSignIn: (email: string, password: string) => Promise<void>
}

const STORAGE_KEY = 'sj-os:session:v1'

function nowIso(): string {
  return new Date().toISOString()
}
function defaultSession(): UserSession {
  const owner = DEMO_USERS[0]
  return { ...owner, isLoggedIn: true, lastLoginAt: nowIso() }
}
function loggedOutSession(): UserSession {
  return { id: '', name: '', role: 'fc', isLoggedIn: false }
}

function load(): UserSession {
  if (typeof localStorage === 'undefined') return defaultSession()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSession()
    const p = JSON.parse(raw) as Partial<UserSession>
    if (!p.id || !p.role) return defaultSession()
    return {
      id: p.id,
      name: p.name ?? '사용자',
      role: p.role,
      teamName: p.teamName,
      position: p.position,
      isLoggedIn: p.isLoggedIn !== false,
      lastLoginAt: p.lastLoginAt
    }
  } catch {
    return defaultSession()
  }
}
function save(s: UserSession): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const supabaseConfigured = getSupabaseConfigStatus().isConfigured
  const authMode: AuthMode = supabaseConfigured ? 'supabase-auth' : 'local-demo'

  const [session, setSession] = useState<UserSession>(() => (supabaseConfigured ? loggedOutSession() : load()))
  const [authState, setAuthState] = useState<AuthUiState>(() =>
    supabaseConfigured ? 'loading' : load().isLoggedIn ? 'logged-in' : 'logged-out'
  )
  const [authError, setAuthError] = useState<string | undefined>()

  // Supabase auth lifecycle (only when configured).
  useEffect(() => {
    if (!supabaseConfigured) return
    let active = true
    const apply = async (): Promise<void> => {
      const res = await resolveSessionAndProfile()
      if (!active) return
      if (res.state === 'ok') {
        setSession({
          id: res.profile.id,
          name: res.profile.name,
          role: res.profile.role,
          teamName: res.profile.teamId,
          isLoggedIn: true,
          lastLoginAt: nowIso()
        })
        setAuthError(undefined)
        setAuthState('logged-in')
      } else if (res.state === 'profile-missing') {
        setSession(loggedOutSession())
        setAuthError(res.message)
        setAuthState('profile-missing')
      } else if (res.state === 'blocked') {
        setSession(loggedOutSession())
        setAuthError(res.message)
        setAuthState('blocked')
      } else {
        setSession(loggedOutSession())
        setAuthState('logged-out')
      }
    }
    void apply()
    const unsub = onAuthStateChange(() => void apply())
    return () => {
      active = false
      unsub()
    }
  }, [supabaseConfigured])

  const value = useMemo<SessionValue>(() => {
    const applyLocal = (next: UserSession): void => {
      setSession(next)
      save(next)
      setAuthState(next.isLoggedIn ? 'logged-in' : 'logged-out')
    }
    return {
      session,
      authMode,
      supabaseConfigured,
      authState,
      authError,
      login: (user) => {
        if (supabaseConfigured) return // demo login disabled in supabase mode
        applyLocal({ ...user, isLoggedIn: true, lastLoginAt: nowIso() })
      },
      logout: () => {
        if (supabaseConfigured) {
          void supabaseSignOut().then(() => {
            setSession(loggedOutSession())
            setAuthState('logged-out')
            setAuthError(undefined)
          })
        } else {
          applyLocal({ ...session, isLoggedIn: false })
        }
      },
      switchUser: (userId) => {
        if (supabaseConfigured) return
        const u = DEMO_USERS.find((d) => d.id === userId)
        if (u) applyLocal({ ...u, isLoggedIn: true, lastLoginAt: nowIso() })
      },
      supabaseSignIn: async (email, password) => {
        setAuthError(undefined)
        setAuthState('loading')
        const r = await signInWithEmailPassword(email, password)
        if (!r.ok) {
          setAuthError(r.message ?? '이메일/비밀번호를 확인해주세요.')
          setAuthState('logged-out')
          return
        }
        // onAuthStateChange will fire resolveSessionAndProfile; also resolve now.
        const res = await resolveSessionAndProfile()
        if (res.state === 'ok') {
          setSession({ id: res.profile.id, name: res.profile.name, role: res.profile.role, teamName: res.profile.teamId, isLoggedIn: true, lastLoginAt: nowIso() })
          setAuthState('logged-in')
        } else if (res.state === 'profile-missing' || res.state === 'blocked') {
          setAuthError(res.message)
          setAuthState(res.state)
        } else {
          setAuthState('logged-out')
        }
      }
    }
  }, [session, authMode, supabaseConfigured, authState, authError])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
