import { useSyncExternalStore } from 'react'
import type { KernelStateSnapshot } from '@shared/kernel'
import { kernel } from './chiefOfStaff'

/** Subscribe a component to the live Company Kernel state snapshot. */
export function useKernel(): KernelStateSnapshot {
  return useSyncExternalStore(kernel.subscribe, kernel.getState, kernel.getState)
}
