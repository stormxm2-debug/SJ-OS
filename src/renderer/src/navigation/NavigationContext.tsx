import { createContext, useContext, useState, type ReactNode } from 'react'
import type { View } from './types'

interface NavigationValue {
  route: View
  navigate: (view: View) => void
}

const NavigationContext = createContext<NavigationValue | null>(null)

/**
 * Minimal in-renderer navigation — no router dependency, no backend. Holds the
 * active view in React state. A later milestone can swap this for real routing
 * without changing call sites.
 */
export function NavigationProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  const [route, setRoute] = useState<View>({ name: 'assistant' })
  return (
    <NavigationContext.Provider value={{ route, navigate: setRoute }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) {
    throw new Error('useNavigation must be used within a NavigationProvider')
  }
  return ctx
}
