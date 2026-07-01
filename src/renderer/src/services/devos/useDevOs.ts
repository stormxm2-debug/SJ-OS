import { useSyncExternalStore } from 'react'
import { devOsRepository } from './DevOsRepository'
import type { DevOsSnapshot } from './types'

/**
 * Subscribe a React component to Development OS memory. The component reads the
 * snapshot from the repository and re-renders when it changes — no business
 * logic in the component itself.
 */
export function useDevOs(): DevOsSnapshot {
  return useSyncExternalStore(
    (onChange) => devOsRepository.subscribe(onChange),
    () => devOsRepository.getSnapshot()
  )
}
