import { useSyncExternalStore } from 'react'
import { releaseRepository } from './ReleaseRepository'
import type { ReleaseSnapshot } from './types'

/**
 * Subscribe a React component to the Release Center. The component reads the
 * snapshot from the repository and re-renders when it changes — no business
 * logic in the component itself. Mirrors useQa / useApprovals / useCto.
 */
export function useRelease(): ReleaseSnapshot {
  return useSyncExternalStore(
    (onChange) => releaseRepository.subscribe(onChange),
    () => releaseRepository.getSnapshot()
  )
}
