import { useSyncExternalStore } from 'react'
import { devOpsRepository } from './DevOpsRepository'
import type { DevOpsSnapshot } from './types'

/**
 * Subscribe a React component to the DevOps Center. The component reads the
 * snapshot from the repository and re-renders when it changes — no business
 * logic in the component itself. Mirrors useRelease / useQa / useApprovals.
 */
export function useDevOps(): DevOpsSnapshot {
  return useSyncExternalStore(
    (onChange) => devOpsRepository.subscribe(onChange),
    () => devOpsRepository.getSnapshot()
  )
}
