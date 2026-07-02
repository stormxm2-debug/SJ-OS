import { useSyncExternalStore } from 'react'
import { teamLeaderRepository } from './TeamLeaderRepository'
import type { TeamLeaderSnapshot } from './types'

/**
 * Subscribe a React component to the Team Leader Workspace snapshot. The
 * repository replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors usePerformance / useSchedule.
 */
export function useTeamLeader(): TeamLeaderSnapshot {
  return useSyncExternalStore(
    (onChange) => teamLeaderRepository.subscribe(onChange),
    () => teamLeaderRepository.getSnapshot()
  )
}
