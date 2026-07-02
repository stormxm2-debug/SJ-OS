import { useSyncExternalStore } from 'react'
import { consultationRepository } from './ConsultationRepository'
import type { ConsultationSnapshot } from './types'

/**
 * Subscribe a React component to the Consultation Workspace snapshot. The
 * repository replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors useTeamLeader / useSchedule.
 */
export function useConsultation(): ConsultationSnapshot {
  return useSyncExternalStore(
    (onChange) => consultationRepository.subscribe(onChange),
    () => consultationRepository.getSnapshot()
  )
}
