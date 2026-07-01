import { DevOsEvents, type DevOsEventName } from './DevOsEvents'
import { DevOsState } from './DevOsState'
import type { DevOsSnapshot, DevSession, WorkerMemory } from './types'

export interface DevOsOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Repository over Development OS memory. Same shape as CompanyRepository:
 * a state holder + event bus, mutations return a result, snapshot is immutable
 * per change. Business logic lives here, not in React components.
 */
export class DevOsRepository {
  constructor(
    private readonly state = new DevOsState(),
    private readonly events = new DevOsEvents()
  ) {}

  getSnapshot(): DevOsSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: DevOsEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emit(type: DevOsEventName, payload?: unknown): void {
    this.events.emit(type, payload)
  }

  getSession(): DevSession {
    return this.state.getSnapshot().session
  }

  updateSession(updates: Partial<DevSession>): DevOsOperationResult<DevSession> {
    const snapshot = this.state.getSnapshot()
    const nextSession: DevSession = {
      ...snapshot.session,
      ...updates,
      updatedAt: new Date().toISOString()
    }
    this.state.setSnapshot({ ...snapshot, session: nextSession })
    this.emit('session:updated', nextSession)
    this.emit('snapshot:updated')
    return { success: true, data: nextSession }
  }

  listWorkers(): WorkerMemory[] {
    return this.state.getSnapshot().workers
  }

  getWorker(workerId: string): WorkerMemory | null {
    return this.state.getSnapshot().workers.find((w) => w.workerId === workerId) ?? null
  }

  updateWorker(
    workerId: string,
    updates: Partial<Omit<WorkerMemory, 'workerId'>>
  ): DevOsOperationResult<WorkerMemory> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.workers.findIndex((w) => w.workerId === workerId)
    if (index === -1) {
      return { success: false, error: 'worker not found' }
    }

    const nextWorker: WorkerMemory = {
      ...snapshot.workers[index],
      ...updates,
      workerId,
      lastUpdated: new Date().toISOString()
    }
    const nextWorkers = [...snapshot.workers]
    nextWorkers[index] = nextWorker
    this.state.setSnapshot({ ...snapshot, workers: nextWorkers })
    this.emit('worker:updated', nextWorker)
    this.emit('snapshot:updated')
    return { success: true, data: nextWorker }
  }
}

export const devOsRepository = new DevOsRepository()
