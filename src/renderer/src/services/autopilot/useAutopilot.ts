import { useSyncExternalStore } from 'react'
import { autopilotService } from './AutopilotService'
import type { AutopilotState } from './types'

/**
 * Subscribe a React component to the Autopilot operating-loop state. The service
 * caches the state and only replaces the reference on change, so it is safe for
 * useSyncExternalStore. Mirrors useLiveCompany / useDevOps.
 */
export function useAutopilot(): AutopilotState {
  return useSyncExternalStore(
    (onChange) => autopilotService.subscribe(onChange),
    () => autopilotService.getSnapshot()
  )
}
