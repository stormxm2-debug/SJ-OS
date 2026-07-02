import { useSyncExternalStore } from 'react'
import { implementationRepository } from './ImplementationRepository'
import type { ImplementationSnapshot } from './types'

/**
 * Subscribe a React component to the Implementation Request snapshot. The
 * repository replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors the other SJ OS use* hooks.
 */
export function useImplementation(): ImplementationSnapshot {
  return useSyncExternalStore(
    (onChange) => implementationRepository.subscribe(onChange),
    () => implementationRepository.getSnapshot()
  )
}
