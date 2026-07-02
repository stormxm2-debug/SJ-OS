import { useSyncExternalStore } from 'react'
import { fcRepository } from './FcRepository'
import type { FcSnapshot } from './types'

/**
 * Subscribe a React component to the FC OS snapshot. The repository replaces the
 * snapshot reference only on change, so it is safe for useSyncExternalStore.
 * Mirrors useDevOs / useLiveCompany.
 */
export function useFc(): FcSnapshot {
  return useSyncExternalStore(
    (onChange) => fcRepository.subscribe(onChange),
    () => fcRepository.getSnapshot()
  )
}
