import { useSyncExternalStore } from 'react'
import { analysisRepository } from './AnalysisRepository'
import type { AnalysisSnapshot } from './types'

/**
 * Subscribe a React component to the Insurance Analysis snapshot. The repository
 * replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors useConsultation / useSchedule.
 */
export function useAnalysis(): AnalysisSnapshot {
  return useSyncExternalStore(
    (onChange) => analysisRepository.subscribe(onChange),
    () => analysisRepository.getSnapshot()
  )
}
