import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEMO_USERS, type DemoUser, type UserRole } from './roleAccess'

/**
 * Local MVP session shell. Holds the current signed-in user + role so the UI can
 * show role-appropriate menus. This is NOT production authentication — it is a
 * local switcher so staff-facing UI can be tested immediately. The default is the
 * owner (김세종 대표), logged in, so existing full-access behavior is preserved.
 * The choice persists in localStorage.
 *
 * Future: replace with a real auth service (server session / SSO).
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

interface SessionValue {
  session: UserSession
  login: (user: DemoUser) => void
  logout: () => void
  switchUser: (userId: string) => void
}

const STORAGE_KEY = 'sj-os:session:v1'

function nowIso(): string {
  return new Date().toISOString()
}

function defaultSession(): UserSession {
  const owner = DEMO_USERS[0]
  return { ...owner, isLoggedIn: true, lastLoginAt: nowIso() }
}

function load(): UserSession {
  if (typeof localStorage === 'undefined') return defaultSession()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSession()
    const parsed = JSON.parse(raw) as Partial<UserSession>
    if (!parsed.id || !parsed.role) return defaultSession()
    return {
      id: parsed.id,
      name: parsed.name ?? '사용자',
      role: parsed.role,
      teamName: parsed.teamName,
      position: parsed.position,
      isLoggedIn: parsed.isLoggedIn !== false,
      lastLoginAt: parsed.lastLoginAt
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
    /* storage unavailable — session stays in-memory */
  }
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<UserSession>(load)

  const value = useMemo<SessionValue>(() => {
    const apply = (next: UserSession): void => {
      setSession(next)
      save(next)
    }
    return {
      session,
      login: (user) => apply({ ...user, isLoggedIn: true, lastLoginAt: nowIso() }),
      logout: () => apply({ ...session, isLoggedIn: false }),
      switchUser: (userId) => {
        const u = DEMO_USERS.find((d) => d.id === userId)
        if (u) apply({ ...u, isLoggedIn: true, lastLoginAt: nowIso() })
      }
    }
  }, [session])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
