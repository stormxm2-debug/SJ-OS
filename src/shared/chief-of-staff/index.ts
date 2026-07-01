import { ChiefOfStaff, type ChiefOfStaffBackends } from './ChiefOfStaff'
import { createMockBackends } from './mock'
import { createKernel, type CompanyKernel } from '../kernel'

export * from './types'
export * from './actions'
export * from './state'
export { deriveProjectName } from './naming'
export { ChiefOfStaff, type ChiefOfStaffBackends } from './ChiefOfStaff'
export { createMockBackends } from './mock'

/**
 * Construct the Chief of Staff wired to its mock planning backends and a
 * Company Kernel. The Chief of Staff talks only to the Kernel; the Kernel owns
 * scheduling, workers, messaging, events and state. Swap either dependency to
 * go live without changing the orchestration.
 */
export function createChiefOfStaff(
  kernel: CompanyKernel = createKernel(),
  backends: ChiefOfStaffBackends = createMockBackends()
): ChiefOfStaff {
  return new ChiefOfStaff(backends, kernel)
}
