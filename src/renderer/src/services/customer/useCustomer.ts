import { useSyncExternalStore } from 'react'
import { customerRepository } from './CustomerRepository'
import type { CustomerSnapshot } from './types'

/**
 * Subscribe a React component to the Customer Workspace snapshot. The repository
 * replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors useFc / useLiveCompany.
 */
export function useCustomer(): CustomerSnapshot {
  return useSyncExternalStore(
    (onChange) => customerRepository.subscribe(onChange),
    () => customerRepository.getSnapshot()
  )
}
