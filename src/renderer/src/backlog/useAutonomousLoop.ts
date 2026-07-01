import { useSyncExternalStore } from 'react'
import { autonomousLoop, type AutonomousState } from './autonomousLoop'

export interface AutonomousApi {
  state: AutonomousState
  start: () => void
  pause: () => void
  resume: () => void
  cancel: () => void
}

/** Subscribe a component to the autonomous execution loop. */
export function useAutonomousLoop(): AutonomousApi {
  const state = useSyncExternalStore(
    autonomousLoop.subscribe,
    autonomousLoop.getState,
    autonomousLoop.getState
  )
  return {
    state,
    start: autonomousLoop.start,
    pause: autonomousLoop.pause,
    resume: autonomousLoop.resume,
    cancel: autonomousLoop.cancel
  }
}
