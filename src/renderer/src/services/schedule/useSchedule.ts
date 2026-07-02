import { useSyncExternalStore } from 'react'
import { scheduleRepository } from './ScheduleRepository'
import type { ScheduleSnapshot } from './types'

/**
 * Subscribe a React component to the Schedule Workspace snapshot. The repository
 * replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors useSalesActivity / useCustomer.
 */
export function useSchedule(): ScheduleSnapshot {
  return useSyncExternalStore(
    (onChange) => scheduleRepository.subscribe(onChange),
    () => scheduleRepository.getSnapshot()
  )
}
