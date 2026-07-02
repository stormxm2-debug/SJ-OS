import { useSyncExternalStore } from 'react'
import { salesActivityRepository } from './SalesActivityRepository'
import type { SalesActivitySnapshot } from './types'

/**
 * Subscribe a React component to the Sales Activity Workspace snapshot. The
 * repository replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors useCustomer / useFc.
 */
export function useSalesActivity(): SalesActivitySnapshot {
  return useSyncExternalStore(
    (onChange) => salesActivityRepository.subscribe(onChange),
    () => salesActivityRepository.getSnapshot()
  )
}
