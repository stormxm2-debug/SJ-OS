import { useSyncExternalStore } from 'react'
import type { ChiefOfStaffState } from '@shared/chief-of-staff'
import { chiefOfStaff as cos } from './chiefOfStaff'

export interface ChiefOfStaffApi {
  state: ChiefOfStaffState
  submit: (request: string) => void
  reset: () => void
}

/** Subscribe a component to the Chief of Staff's live workflow state. */
export function useChiefOfStaff(): ChiefOfStaffApi {
  const state = useSyncExternalStore(cos.subscribe, cos.getState, cos.getState)
  return {
    state,
    submit: cos.receiveRequest,
    reset: cos.reset
  }
}
