import { useSyncExternalStore } from 'react'
import { approvalRepository } from './ApprovalRepository'
import type { ApprovalSnapshot } from './types'

/**
 * Subscribe a React component to the Approval Center. The component reads the
 * snapshot from the repository and re-renders when it changes — no business
 * logic in the component itself. Mirrors useCto / usePm / useDevOs.
 */
export function useApprovals(): ApprovalSnapshot {
  return useSyncExternalStore(
    (onChange) => approvalRepository.subscribe(onChange),
    () => approvalRepository.getSnapshot()
  )
}
