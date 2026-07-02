import { useSyncExternalStore } from 'react'
import { qaRepository } from './QaRepository'
import type { QaSnapshot } from './types'

/**
 * Subscribe a React component to the QA Center. The component reads the snapshot
 * from the repository and re-renders when it changes — no business logic in the
 * component itself. Mirrors useApprovals / useCto / usePm / useDevOs.
 */
export function useQa(): QaSnapshot {
  return useSyncExternalStore(
    (onChange) => qaRepository.subscribe(onChange),
    () => qaRepository.getSnapshot()
  )
}
