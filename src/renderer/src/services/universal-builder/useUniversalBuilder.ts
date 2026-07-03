import { useSyncExternalStore } from 'react'
import { universalBuilderRepository } from './UniversalBuilderRepository'
import type { UniversalBuilderSnapshot } from './types'

/**
 * Subscribe a React component to the Universal Builder snapshot. The repository
 * replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors the other SJ OS use* hooks.
 */
export function useUniversalBuilder(): UniversalBuilderSnapshot {
  return useSyncExternalStore(
    (onChange) => universalBuilderRepository.subscribe(onChange),
    () => universalBuilderRepository.getSnapshot()
  )
}
