import type {
  Capability,
  ExecutionStatus,
  KernelWorkerRecord,
  WorkerState
} from './types'

/**
 * Worker Registry — the authoritative directory of workers.
 *
 * It owns worker records: identity, capabilities, metadata and live status.
 * Nothing else in the company stores who the workers are. The Scheduler asks
 * the Registry which workers can do a capability and which are idle; the Kernel
 * flips a worker's status as work is dispatched and completed. Workers do not
 * appear in each other's code — only here, behind this interface.
 */
export interface WorkerRegistry {
  register(record: KernelWorkerRecord): void
  remove(workerId: string): void
  get(workerId: string): KernelWorkerRecord | undefined
  all(): KernelWorkerRecord[]
  findByCapability(capability: Capability): KernelWorkerRecord[]
  idleByCapability(capability: Capability): KernelWorkerRecord[]
  setState(workerId: string, state: WorkerState, currentTaskId: string | null): void
  setActivity(workerId: string, activity: ExecutionStatus): void
}

/** Default in-memory registry. Replaceable by a distributed directory. */
export class InMemoryWorkerRegistry implements WorkerRegistry {
  private readonly byId = new Map<string, KernelWorkerRecord>()

  register(record: KernelWorkerRecord): void {
    this.byId.set(record.id, { ...record, capabilities: [...record.capabilities] })
  }

  remove(workerId: string): void {
    this.byId.delete(workerId)
  }

  get(workerId: string): KernelWorkerRecord | undefined {
    const r = this.byId.get(workerId)
    return r ? clone(r) : undefined
  }

  all(): KernelWorkerRecord[] {
    return [...this.byId.values()].map(clone)
  }

  findByCapability(capability: Capability): KernelWorkerRecord[] {
    return this.all().filter((w) => w.capabilities.includes(capability))
  }

  idleByCapability(capability: Capability): KernelWorkerRecord[] {
    return this.all().filter(
      (w) => w.state === 'idle' && w.capabilities.includes(capability)
    )
  }

  setState(workerId: string, state: WorkerState, currentTaskId: string | null): void {
    const r = this.byId.get(workerId)
    if (!r) return
    r.state = state
    r.currentTaskId = currentTaskId
  }

  setActivity(workerId: string, activity: ExecutionStatus): void {
    const r = this.byId.get(workerId)
    if (!r) return
    r.activity = activity
  }
}

function clone(r: KernelWorkerRecord): KernelWorkerRecord {
  return { ...r, capabilities: [...r.capabilities], metadata: { ...r.metadata } }
}
