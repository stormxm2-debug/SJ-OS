import { useSyncExternalStore } from 'react'
import { performanceRepository } from './PerformanceRepository'
import type { PerformanceSnapshot } from './types'

/**
 * Subscribe a React component to the Performance Workspace snapshot. The
 * repository replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors useSchedule / useSalesActivity.
 */
export function usePerformance(): PerformanceSnapshot {
  return useSyncExternalStore(
    (onChange) => performanceRepository.subscribe(onChange),
    () => performanceRepository.getSnapshot()
  )
}
