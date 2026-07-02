import { useSyncExternalStore } from 'react'
import { liveCompanyService } from './LiveCompanyService'
import type { CompanySnapshot } from './types'

/**
 * Subscribe a React component to the unified live-company snapshot. The service
 * recomputes the snapshot whenever any underlying module changes and caches it,
 * so the reference is stable between changes — safe for useSyncExternalStore.
 * Mirrors useDevOps / useRelease / useQa.
 */
export function useLiveCompany(): CompanySnapshot {
  return useSyncExternalStore(
    (onChange) => liveCompanyService.subscribe(onChange),
    () => liveCompanyService.getSnapshot()
  )
}
