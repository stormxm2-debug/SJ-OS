import { createContext, useContext, useState, type ReactNode } from 'react'

/**
 * App mode — CEO (대표) vs Staff (직원).
 *
 * This is a UI/UX foundation only: it changes which menus and Jarvis suggestions
 * are shown. It is NOT a permission/auth boundary — no command is hard-blocked by
 * mode yet. The default is CEO. The choice persists in localStorage so it
 * survives restarts.
 */

export type AppMode = 'ceo' | 'staff'

interface AppModeValue {
  mode: AppMode
  setMode: (mode: AppMode) => void
}

const STORAGE_KEY = 'sj-os:app-mode:v1'

function loadMode(): AppMode {
  if (typeof localStorage === 'undefined') return 'ceo'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'staff' ? 'staff' : 'ceo'
  } catch {
    return 'ceo'
  }
}

function saveMode(mode: AppMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* storage unavailable — mode stays in-memory for this session */
  }
}

const AppModeContext = createContext<AppModeValue | null>(null)

export function AppModeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setModeState] = useState<AppMode>(() => loadMode())
  const setMode = (next: AppMode): void => {
    setModeState(next)
    saveMode(next)
  }
  return <AppModeContext.Provider value={{ mode, setMode }}>{children}</AppModeContext.Provider>
}

export function useAppMode(): AppModeValue {
  const ctx = useContext(AppModeContext)
  if (!ctx) {
    throw new Error('useAppMode must be used within an AppModeProvider')
  }
  return ctx
}
