import { useSyncExternalStore } from 'react'
import type { CompanyStartupSnapshot } from '@shared/startup'
import { createInitialStartupState } from '@shared/startup'

interface CompanyStartupStore {
  getSnapshot: () => CompanyStartupSnapshot
  subscribe: (listener: () => void) => () => void
  start: () => void
}

let snapshot: CompanyStartupSnapshot = createInitialStartupState()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function setSnapshot(next: CompanyStartupSnapshot): void {
  snapshot = next
  emit()
}

export const companyStartupStore: CompanyStartupStore = {
  getSnapshot: () => snapshot,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  start: () => {
    if (typeof window === 'undefined' || !window.sj?.companyStartup) return
    void window.sj.companyStartup.start().then((next) => setSnapshot(next))
  }
}

if (typeof window !== 'undefined' && window.sj?.companyStartup) {
  window.sj.companyStartup.onStateChange((next) => setSnapshot(next))
}

export function useCompanyStartup(): CompanyStartupSnapshot {
  return useSyncExternalStore(
    companyStartupStore.subscribe,
    companyStartupStore.getSnapshot,
    companyStartupStore.getSnapshot
  )
}

export function hydrateCompanyStartupState(next: CompanyStartupSnapshot): void {
  setSnapshot(next)
}
