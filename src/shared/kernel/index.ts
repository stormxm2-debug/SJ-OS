import { CompanyKernel, defaultModules, type KernelModules } from './Kernel'
import { createDefaultWorkers } from './defaultWorkers'
import type { Worker } from './worker'

export * from './types'
export * from './events'
export * from './meeting'
export * from './department'
export * from './asset'
export { AssetStore } from './assetStore'
export * from './messageBus'
export * from './scheduler'
export * from './workerRegistry'
export { MeetingEngine } from './MeetingEngine'
export { KernelState, isTerminal, type KernelStateSnapshot } from './state'
export { MockWorker, type Worker } from './worker'
export { createDefaultWorkers } from './defaultWorkers'
export { CompanyKernel, defaultModules, type KernelModules } from './Kernel'

/**
 * Construct the Company Kernel with default in-memory modules and the default
 * worker roster. This is the single wiring point: swap `modules` or `workers`
 * to change transport, scheduling policy, or the workforce without touching the
 * Kernel or anything above it.
 */
export function createKernel(
  modules: KernelModules = defaultModules(),
  workers: Worker[] = createDefaultWorkers()
): CompanyKernel {
  return new CompanyKernel(modules, workers)
}
