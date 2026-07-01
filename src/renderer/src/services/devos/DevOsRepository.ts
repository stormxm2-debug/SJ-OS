import { DevOsEvents, type DevOsEventName } from './DevOsEvents'
import { DevOsState } from './DevOsState'
import { devOsSeed } from './seed'
import type {
  DevOsLogEntry,
  DevOsLogType,
  DevOsSnapshot,
  DevSession,
  WorkerMemory
} from './types'

export interface DevOsOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

function cloneSeed(): DevOsSnapshot {
  return JSON.parse(JSON.stringify(devOsSeed)) as DevOsSnapshot
}

/**
 * Repository over Development OS memory. Same shape as CompanyRepository:
 * a state holder + event bus, mutations return a result, snapshot is immutable
 * per change. All DevOS business logic lives here, not in React components.
 * Meaningful changes also append to the persisted Sprint event log.
 */
export class DevOsRepository {
  private seq = 0

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

  private nextId(): string {
    this.seq += 1
    return `evt-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: DevOsLogType, message: string): DevOsLogEntry {
    return { id: this.nextId(), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: DevOsSnapshot, type: DevOsLogType, message: string): DevOsSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  // --- reads ---------------------------------------------------------------

  getSession(): DevSession {
    return this.state.getSnapshot().session
  }

  listWorkers(): WorkerMemory[] {
    return this.state.getSnapshot().workers
  }

  getWorker(workerId: string): WorkerMemory | null {
    return this.state.getSnapshot().workers.find((w) => w.workerId === workerId) ?? null
  }

  getEventLog(): DevOsLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full snapshot, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- low-level mutations (kept for compatibility) ------------------------

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

  // --- session operations --------------------------------------------------

  private commitSession(
    session: DevSession,
    snapshot: DevOsSnapshot,
    type: DevOsLogType,
    message: string
  ): DevOsOperationResult<DevSession> {
    const withSession: DevOsSnapshot = { ...snapshot, session }
    this.state.setSnapshot(this.withLog(withSession, type, message))
    this.emit('session:updated', session)
    this.emit('snapshot:updated')
    return { success: true, data: session }
  }

  /** Mark the current task complete: progress → 100, status → completed. */
  completeCurrentTask(): DevOsOperationResult<DevSession> {
    const snapshot = this.state.getSnapshot()
    const session: DevSession = {
      ...snapshot.session,
      progress: 100,
      status: 'completed',
      updatedAt: new Date().toISOString()
    }
    return this.commitSession(
      session,
      snapshot,
      'task-completed',
      `Completed task: ${snapshot.session.currentTask}`
    )
  }

  /** Promote the queued next action into the active task and start it fresh. */
  moveToNextAction(): DevOsOperationResult<DevSession> {
    const snapshot = this.state.getSnapshot()
    const promoted = snapshot.session.nextAction.trim()
    if (!promoted) {
      return { success: false, error: 'no next action to move to' }
    }
    const session: DevSession = {
      ...snapshot.session,
      currentTask: promoted,
      status: 'active',
      progress: 0,
      nextAction: 'Define the next action',
      updatedAt: new Date().toISOString()
    }
    return this.commitSession(
      session,
      snapshot,
      'next-action-changed',
      `Now working on: ${promoted}`
    )
  }

  increaseProgress(amount = 10): DevOsOperationResult<DevSession> {
    const snapshot = this.state.getSnapshot()
    const previous = snapshot.session.progress
    const nextProgress = clampPercent(previous + amount)
    if (nextProgress === previous) {
      return { success: false, error: 'progress unchanged' }
    }
    const session: DevSession = {
      ...snapshot.session,
      progress: nextProgress,
      updatedAt: new Date().toISOString()
    }
    return this.commitSession(
      session,
      snapshot,
      'progress-changed',
      `Progress ${previous}% → ${nextProgress}%`
    )
  }

  setNextAction(nextAction: string): DevOsOperationResult<DevSession> {
    const text = nextAction.trim()
    if (!text) {
      return { success: false, error: 'next action is empty' }
    }
    const snapshot = this.state.getSnapshot()
    const session: DevSession = {
      ...snapshot.session,
      nextAction: text,
      updatedAt: new Date().toISOString()
    }
    return this.commitSession(session, snapshot, 'next-action-changed', `Next action: ${text}`)
  }

  addBlocker(reason: string): DevOsOperationResult<DevSession> {
    const text = reason.trim()
    if (!text) {
      return { success: false, error: 'blocker reason is empty' }
    }
    const snapshot = this.state.getSnapshot()
    const session: DevSession = {
      ...snapshot.session,
      status: 'blocked',
      blockedReason: text,
      updatedAt: new Date().toISOString()
    }
    return this.commitSession(session, snapshot, 'blocker-added', `Blocked: ${text}`)
  }

  clearBlocker(): DevOsOperationResult<DevSession> {
    const snapshot = this.state.getSnapshot()
    if (snapshot.session.status !== 'blocked' && snapshot.session.blockedReason === null) {
      return { success: false, error: 'no active blocker' }
    }
    const session: DevSession = {
      ...snapshot.session,
      status: 'active',
      blockedReason: null,
      updatedAt: new Date().toISOString()
    }
    return this.commitSession(session, snapshot, 'blocker-cleared', 'Blocker cleared')
  }

  // --- worker operations ---------------------------------------------------

  private commitWorker(
    workerId: string,
    mutate: (worker: WorkerMemory) => WorkerMemory,
    type: DevOsLogType,
    message: (worker: WorkerMemory) => string
  ): DevOsOperationResult<WorkerMemory> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.workers.findIndex((w) => w.workerId === workerId)
    if (index === -1) {
      return { success: false, error: 'worker not found' }
    }
    const nextWorker: WorkerMemory = {
      ...mutate(snapshot.workers[index]),
      workerId,
      lastUpdated: new Date().toISOString()
    }
    const nextWorkers = [...snapshot.workers]
    nextWorkers[index] = nextWorker
    const withWorkers: DevOsSnapshot = { ...snapshot, workers: nextWorkers }
    this.state.setSnapshot(this.withLog(withWorkers, type, message(nextWorker)))
    this.emit('worker:updated', nextWorker)
    this.emit('snapshot:updated')
    return { success: true, data: nextWorker }
  }

  /** Move the worker's current work into completed and clear current work. */
  completeWorkerCurrentWork(workerId: string): DevOsOperationResult<WorkerMemory> {
    const worker = this.getWorker(workerId)
    if (!worker) return { success: false, error: 'worker not found' }
    const done = worker.currentWork.trim()
    if (!done) return { success: false, error: 'no current work to complete' }
    return this.commitWorker(
      workerId,
      (w) => ({ ...w, currentWork: '', completedWork: [done, ...w.completedWork] }),
      'worker-updated',
      (w) => `${w.name} completed: ${done}`
    )
  }

  addCompletedWork(workerId: string, entry: string): DevOsOperationResult<WorkerMemory> {
    const text = entry.trim()
    if (!text) return { success: false, error: 'entry is empty' }
    return this.commitWorker(
      workerId,
      (w) => ({ ...w, completedWork: [text, ...w.completedWork] }),
      'worker-updated',
      (w) => `${w.name} logged completed: ${text}`
    )
  }

  addBlockedWork(workerId: string, entry: string): DevOsOperationResult<WorkerMemory> {
    const text = entry.trim()
    if (!text) return { success: false, error: 'entry is empty' }
    return this.commitWorker(
      workerId,
      (w) => ({ ...w, blockedWork: [text, ...w.blockedWork] }),
      'blocker-added',
      (w) => `${w.name} blocked: ${text}`
    )
  }

  clearBlockedWork(workerId: string): DevOsOperationResult<WorkerMemory> {
    const worker = this.getWorker(workerId)
    if (!worker) return { success: false, error: 'worker not found' }
    if (worker.blockedWork.length === 0) {
      return { success: false, error: 'no blocked work' }
    }
    return this.commitWorker(
      workerId,
      (w) => ({ ...w, blockedWork: [] }),
      'blocker-cleared',
      (w) => `${w.name} blockers cleared`
    )
  }

  setWorkerConfidence(workerId: string, confidence: number): DevOsOperationResult<WorkerMemory> {
    const value = clampPercent(confidence)
    return this.commitWorker(
      workerId,
      (w) => ({ ...w, confidence: value }),
      'worker-updated',
      (w) => `${w.name} confidence → ${value}%`
    )
  }

  /** Refresh only the worker's lastUpdated timestamp. */
  touchWorker(workerId: string): DevOsOperationResult<WorkerMemory> {
    return this.commitWorker(
      workerId,
      (w) => ({ ...w }),
      'worker-updated',
      (w) => `${w.name} refreshed`
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset all DevOS memory (session, workers, event log) back to the seed. */
  resetDemoState(): DevOsOperationResult<DevOsSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'DevOS demo state reset to seed')
    this.state.setSnapshot(fresh)
    this.emit('snapshot:updated')
    return { success: true, data: fresh }
  }
}

export const devOsRepository = new DevOsRepository()
