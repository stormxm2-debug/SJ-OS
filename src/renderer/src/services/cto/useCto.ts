import { useSyncExternalStore } from 'react'
import { ctoRepository } from './CtoRepository'
import type { CtoSnapshot } from './types'

/**
 * Subscribe a React component to the CTO Room. The component reads the snapshot
 * from the repository and re-renders when it changes — no business logic in the
 * component itself. Mirrors usePm / useDevOs.
 */
export function useCto(): CtoSnapshot {
  return useSyncExternalStore(
    (onChange) => ctoRepository.subscribe(onChange),
    () => ctoRepository.getSnapshot()
  )
}
