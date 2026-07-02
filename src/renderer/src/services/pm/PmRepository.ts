import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { PmEvents, type PmEventName } from './PmEvents'
import { PmState } from './PmState'
import { pmSeed } from './seed'
import type {
  PmBacklogItem,
  PmComplexity,
  PmEpic,
  PmFeature,
  PmLogEntry,
  PmLogType,
  PmPriority,
  PmSnapshot,
  PmTask
} from './types'

export interface PmOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

function cloneSeed(): PmSnapshot {
  return JSON.parse(JSON.stringify(pmSeed)) as PmSnapshot
}

/**
 * Repository over the PM Planner plan. Same shape as DevOsRepository /
 * CompanyRepository: a state holder + event bus, mutations return a result and
 * persist through PmState. All planning business logic lives here, not in React
 * components. Meaningful changes also append to the persisted event log.
 *
 * The plan is a hierarchy: backlogItem → epic → feature → task. Actions are safe
 * and local only — no external API, no database.
 */
export class PmRepository {
  private seq = 0

  constructor(
    private readonly state = new PmState(),
    private readonly events = new PmEvents()
  ) {}

  getSnapshot(): PmSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: PmEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('plan:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: PmLogType, message: string): PmLogEntry {
    return { id: this.nextId('pmevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: PmSnapshot, type: PmLogType, message: string): PmSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  /** Persist a new snapshot (already log-augmented) and notify subscribers. */
  private commit(snapshot: PmSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listBacklogItems(): PmBacklogItem[] {
    return this.state.getSnapshot().backlogItems
  }

  listEpics(): PmEpic[] {
    return this.state.getSnapshot().epics
  }

  listFeatures(): PmFeature[] {
    return this.state.getSnapshot().features
  }

  listTasks(): PmTask[] {
    return this.state.getSnapshot().tasks
  }

  getEventLog(): PmLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full plan, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- plan generation -----------------------------------------------------

  /**
   * Generate a standard Epic → Features → Tasks breakdown for a backlog item.
   * Deterministic and local: turns a high-level item into a delivery epic with
   * Foundation / Experience / Integration features, each with concrete tasks.
   */
  generatePlanFromBacklogItem(backlogItemId: string): PmOperationResult<PmEpic> {
    const snapshot = this.state.getSnapshot()
    const item = snapshot.backlogItems.find((b) => b.id === backlogItemId)
    if (!item) return { success: false, error: 'backlog item not found' }

    const now = new Date().toISOString()
    const base = (title: string, priority: PmPriority, complexity: PmComplexity, owner: string) => ({
      title,
      priority,
      status: 'planned' as const,
      ownerWorkerId: owner,
      dependencies: [] as string[],
      estimatedComplexity: complexity,
      createdAt: now,
      updatedAt: now
    })

    const epic: PmEpic = {
      id: this.nextId('epic'),
      kind: 'epic',
      backlogItemId: item.id,
      ...base(`${item.title} — Delivery`, item.priority, item.estimatedComplexity, item.ownerWorkerId),
      acceptanceCriteria: [
        `Delivers the outcome of "${item.title}"`,
        'Reuses the existing architecture and local data',
        'Typecheck and build pass'
      ]
    }

    const featureSpecs: Array<{ title: string; owner: string; complexity: PmComplexity; criteria: string[] }> = [
      {
        title: 'Foundation',
        owner: 'backend',
        complexity: 'M',
        criteria: ['Domain model and repository defined', 'State persists locally']
      },
      {
        title: 'Experience',
        owner: 'frontend',
        complexity: 'M',
        criteria: ['UI renders from local data', 'Primary flow works end to end']
      },
      {
        title: 'Integration',
        owner: 'qa',
        complexity: 'S',
        criteria: ['Wired into navigation and DevOS', 'Verified by typecheck and build']
      }
    ]

    const features: PmFeature[] = []
    const tasks: PmTask[] = []
    for (const spec of featureSpecs) {
      const feature: PmFeature = {
        id: this.nextId('feat'),
        kind: 'feature',
        epicId: epic.id,
        ...base(`${item.title} · ${spec.title}`, item.priority, spec.complexity, spec.owner),
        acceptanceCriteria: spec.criteria
      }
      features.push(feature)
      for (const step of ['Design', 'Build', 'Verify']) {
        tasks.push({
          id: this.nextId('task'),
          kind: 'task',
          featureId: feature.id,
          ...base(`${step} ${spec.title.toLowerCase()}`, item.priority, 'S', spec.owner),
          acceptanceCriteria: [`${step} step meets the feature’s acceptance criteria`],
          blocker: null
        })
      }
    }

    const next: PmSnapshot = {
      ...snapshot,
      epics: [...snapshot.epics, epic],
      features: [...snapshot.features, ...features],
      tasks: [...snapshot.tasks, ...tasks]
    }
    this.commit(
      this.withLog(next, 'plan-generated', `Generated plan for "${item.title}": 1 epic, ${features.length} features, ${tasks.length} tasks`)
    )
    return { success: true, data: epic }
  }

  // --- task operations -----------------------------------------------------

  /** Apply a mutation to one task, returning the changed task and the new task
   *  list without committing. The caller commits with its own log entry. */
  private withUpdatedTask(
    snapshot: PmSnapshot,
    taskId: string,
    mutate: (task: PmTask) => PmTask
  ): { task: PmTask; tasks: PmTask[] } | null {
    const index = snapshot.tasks.findIndex((t) => t.id === taskId)
    if (index === -1) return null
    const task: PmTask = { ...mutate(snapshot.tasks[index]), updatedAt: new Date().toISOString() }
    const tasks = [...snapshot.tasks]
    tasks[index] = task
    return { task, tasks }
  }

  /** Mark a task complete. If it completes the last open task of a feature,
   *  the feature is rolled up to completed too. */
  markTaskComplete(taskId: string): PmOperationResult<PmTask> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedTask(snapshot, taskId, (t) => ({
      ...t,
      status: 'completed',
      blocker: null
    }))
    if (!result) return { success: false, error: 'task not found' }

    let nextFeatures = snapshot.features
    const siblings = result.tasks.filter((t) => t.featureId === result.task.featureId)
    if (siblings.length > 0 && siblings.every((t) => t.status === 'completed')) {
      nextFeatures = snapshot.features.map((f) =>
        f.id === result.task.featureId
          ? { ...f, status: 'completed', updatedAt: new Date().toISOString() }
          : f
      )
    }

    this.commit(
      this.withLog(
        { ...snapshot, tasks: result.tasks, features: nextFeatures },
        'task-completed',
        `Completed task: ${result.task.title}`
      )
    )
    return { success: true, data: result.task }
  }

  /** Assign a task to a DevOS worker. */
  assignTaskToWorker(taskId: string, workerId: string): PmOperationResult<PmTask> {
    const owner = workerId.trim()
    if (!owner) return { success: false, error: 'worker id is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedTask(snapshot, taskId, (t) => ({ ...t, ownerWorkerId: owner }))
    if (!result) return { success: false, error: 'task not found' }
    this.commit(
      this.withLog(
        { ...snapshot, tasks: result.tasks },
        'task-assigned',
        `Assigned task "${result.task.title}" to ${owner}`
      )
    )
    return { success: true, data: result.task }
  }

  /** Add a blocker to a task; sets its status to blocked. */
  addBlocker(taskId: string, reason: string): PmOperationResult<PmTask> {
    const text = reason.trim()
    if (!text) return { success: false, error: 'blocker reason is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedTask(snapshot, taskId, (t) => ({
      ...t,
      status: 'blocked',
      blocker: text
    }))
    if (!result) return { success: false, error: 'task not found' }
    this.commit(
      this.withLog(
        { ...snapshot, tasks: result.tasks },
        'blocker-added',
        `Blocked task "${result.task.title}": ${text}`
      )
    )
    return { success: true, data: result.task }
  }

  /** Clear a task's blocker; returns it to in_progress. */
  clearBlocker(taskId: string): PmOperationResult<PmTask> {
    const snapshot = this.state.getSnapshot()
    const current = snapshot.tasks.find((t) => t.id === taskId)
    if (!current) return { success: false, error: 'task not found' }
    if (current.status !== 'blocked' && current.blocker === null) {
      return { success: false, error: 'no active blocker' }
    }
    const result = this.withUpdatedTask(snapshot, taskId, (t) => ({
      ...t,
      status: 'in_progress',
      blocker: null
    }))
    if (!result) return { success: false, error: 'task not found' }
    this.commit(
      this.withLog(
        { ...snapshot, tasks: result.tasks },
        'blocker-cleared',
        `Cleared blocker on task: ${result.task.title}`
      )
    )
    return { success: true, data: result.task }
  }

  // --- feature promotion (DevOS integration) -------------------------------

  /**
   * Promote a feature to the active Development OS session. Marks the feature
   * in_progress in the plan, then updates the DevOS session (currentEpic /
   * currentFeature / currentTask / nextAction) and lets DevOS log the change.
   * DevOS remains the source of truth for "what we're working on now".
   */
  promoteFeatureToActive(featureId: string): PmOperationResult<PmFeature> {
    const snapshot = this.state.getSnapshot()
    const feature = snapshot.features.find((f) => f.id === featureId)
    if (!feature) return { success: false, error: 'feature not found' }
    const epic = snapshot.epics.find((e) => e.id === feature.epicId)
    const featureTasks = snapshot.tasks.filter((t) => t.featureId === featureId)
    const activeTask = featureTasks.find((t) => t.status !== 'completed') ?? featureTasks[0]

    const nextFeature: PmFeature = { ...feature, status: 'in_progress', updatedAt: new Date().toISOString() }
    const nextFeatures = snapshot.features.map((f) => (f.id === featureId ? nextFeature : f))
    this.commit(
      this.withLog(
        { ...snapshot, features: nextFeatures },
        'feature-promoted',
        `Promoted feature to active DevOS session: ${feature.title}`
      )
    )

    // Update the Development OS session using its existing public API. The
    // setNextAction call also records a DevOS event-log entry.
    devOsRepository.updateSession({
      status: 'active',
      currentEpic: epic?.title ?? feature.title,
      currentFeature: feature.title,
      currentTask: activeTask?.title ?? feature.title
    })
    devOsRepository.setNextAction(`Advance feature: ${feature.title}`)

    return { success: true, data: nextFeature }
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the PM plan back to the seed. */
  resetPlan(): PmOperationResult<PmSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'PM plan reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const pmRepository = new PmRepository()
