import { useSyncExternalStore } from 'react'
import { pmRepository } from './PmRepository'
import type { PmSnapshot } from './types'

/**
 * Subscribe a React component to the PM Planner plan. The component reads the
 * snapshot from the repository and re-renders when it changes — no business
 * logic in the component itself. Mirrors useDevOs.
 */
export function usePm(): PmSnapshot {
  return useSyncExternalStore(
    (onChange) => pmRepository.subscribe(onChange),
    () => pmRepository.getSnapshot()
  )
}
