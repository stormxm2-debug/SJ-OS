import type {
  ActionContext,
  RequestClassifier,
  StatusReporter,
  TaskPlanner,
  WorkQueueBuilder
} from './actions'
import {
  initialChiefOfStaffState,
  type ChiefOfStaffState,
  type CosLogActor,
  type CosPhase
} from './state'
import { deriveProjectName } from './naming'
import type {
  Assignment,
  CeoRequest,
  Project,
  ProgressSnapshot,
  ProjectPhase,
  WorkItem,
  WorkItemState
} from './types'
import type { CompanyKernel } from '../kernel'
import type {
  KernelEvent,
  Priority as KernelPriority,
  ProjectState as KernelProjectState,
  TaskSpec,
  TaskState as KernelTaskState
} from '../kernel'

/** The Chief of Staff's PLANNING backends. Assignment/dispatch/tracking now
 *  belong to the Company Kernel, not here. */
export interface ChiefOfStaffBackends {
  classifier: RequestClassifier
  taskPlanner: TaskPlanner
  queueBuilder: WorkQueueBuilder
  statusReporter: StatusReporter
}

/**
 * The Chief of Staff — the company's first operational AI employee.
 *
 * Since Sprint 2 it communicates ONLY with the Company Kernel. It plans the
 * work (classify → size → break down → sequence) and then hands the work queue
 * to the Kernel. It NEVER assigns a worker, dispatches work, or tracks
 * execution — the Kernel does all of that. The Chief of Staff observes the
 * Kernel's state and events to mirror progress for the CEO and to write the
 * final report.
 *
 * Its own observable state (for `useSyncExternalStore`/IPC) is a projection of
 * Kernel state; the Kernel remains the single source of truth.
 */
export class ChiefOfStaff {
  private state: ChiefOfStaffState = initialChiefOfStaffState()
  private readonly listeners = new Set<() => void>()
  private controller: AbortController | null = null
  private projectId: string | null = null
  private kernelUnsub: (() => void) | null = null
  private eventUnsub: (() => void) | null = null
  private seq = 0
  private startedAt = 0

  constructor(
    private readonly backends: ChiefOfStaffBackends,
    private readonly kernel: CompanyKernel
  ) {}

  // ---- Observable surface --------------------------------------------------

  getState = (): ChiefOfStaffState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Capability 1 — receive a CEO request and start the workflow. */
  receiveRequest = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.isBusy()) return
    this.reset()
    void this.run(trimmed)
  }

  reset = (): void => {
    this.controller?.abort()
    this.controller = null
    this.kernelUnsub?.()
    this.kernelUnsub = null
    this.eventUnsub?.()
    this.eventUnsub = null
    this.kernel.reset()
    this.projectId = null
    this.seq = 0
    this.startedAt = 0
    this.state = initialChiefOfStaffState()
    this.emit()
  }

  // ---- Workflow ------------------------------------------------------------

  private async run(text: string): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    this.startedAt = Date.now()
    const ctx = this.actionContext(controller.signal)

    try {
      // 1) Receive the request.
      const request: CeoRequest = {
        id: this.id('req'),
        text,
        receivedAt: this.elapsed()
      }
      this.patch({ phase: 'receiving', request })
      this.log('ceo', `Request received: “${text}”`)

      // Observe the Kernel for the duration of this run.
      this.kernelUnsub = this.kernel.subscribe(() => this.syncFromKernel())
      this.eventUnsub = this.kernel.onEvent((e) => this.onKernelEvent(e))
      if (controller.signal.aborted) return

      // 3 + 4) Classify + size (planning brain).
      this.patch({ phase: 'classifying' })
      const classification = await this.backends.classifier.classify(request, ctx)
      this.patch({ classification })
      this.log(
        'chief_of_staff',
        `Classified as ${classification.type.replace('_', ' ')} · ${classification.priority} priority · size ${classification.size}.`
      )
      if (controller.signal.aborted) return

      // AI MEETING — the team discusses and agrees a strategy BEFORE any coding.
      // The Kernel owns the meeting; its decision drives the plan below.
      this.patch({ phase: 'meeting' })
      this.log('chief_of_staff', 'Convening the kickoff meeting…')
      const meetingId = this.kernel.convene({
        request: text,
        requestType: classification.type,
        size: classification.size,
        priorityHint: classification.priority,
        featureCount: classification.featureCount
      })
      const meeting = await Promise.race([
        this.kernel.awaitMeeting(meetingId),
        this.abortSignal(controller.signal)
      ])
      if (meeting === 'aborted' || controller.signal.aborted) return
      const decision = meeting.decision
      this.log(
        'chief_of_staff',
        `Meeting approved — ${decision?.consensus ?? 'consensus reached'}`
      )

      // 2) Create the project IN THE KERNEL (the Kernel owns projects).
      this.patch({ phase: 'creating_project' })
      const name = deriveProjectName(text)
      const description = decision
        ? `${decision.strategy} Architecture: ${decision.architecture}`
        : `${classification.summary}. From: “${text}”`
      const projectId = this.kernel.createProject(name, description)
      this.projectId = projectId
      const project: Project = {
        id: projectId,
        name,
        description,
        repository: null,
        phase: 'created',
        createdAt: request.receivedAt
      }
      this.patch({ project })
      if (controller.signal.aborted) return

      // 5) Break down the work (planning brain). The meeting's decision drives
      // which capabilities the plan engages — that is what the roles do next.
      this.patch({ phase: 'planning' })
      const planningClassification = decision
        ? { ...classification, requiredRoles: decision.requiredCapabilities }
        : classification
      const breakdown = await this.backends.taskPlanner.plan(
        project,
        planningClassification,
        ctx
      )
      this.patch({ breakdown })
      this.log(
        'chief_of_staff',
        `Planned ${breakdown.featureCount} feature(s), ${breakdown.taskCount} task(s), ${breakdown.subtaskCount} subtask(s).`
      )
      if (controller.signal.aborted) return

      // 6) Sequence into a work queue (planning brain).
      this.patch({ phase: 'queuing' })
      const queue = await this.backends.queueBuilder.build(breakdown, ctx)
      this.patch({ queue })
      this.log('chief_of_staff', `Built a work queue of ${queue.items.length} item(s).`)
      if (controller.signal.aborted) return

      // 7 + 8) Hand the queue to the Kernel. The KERNEL schedules, assigns via
      // the Worker Registry, dispatches over the Message Bus, and tracks state.
      // The Chief of Staff never dispatches work itself.
      this.patch({ phase: 'assigning' })
      this.log('chief_of_staff', 'Submitting the work queue to the Company Kernel…')
      const taskPriority = decision?.priority ?? toKernelPriority(classification.priority)
      const specs: TaskSpec[] = queue.items.map((it) => ({
        id: it.id,
        title: it.title,
        capability: it.role,
        priority: taskPriority,
        dependsOn: it.dependsOn
      }))
      this.kernel.submitTasks(projectId, specs)

      // Wait for the Kernel to settle the project (or for a reset/abort).
      const outcome = await Promise.race([
        this.kernel.awaitProject(projectId).then(() => 'settled' as const),
        this.abortSignal(controller.signal)
      ])
      if (outcome === 'aborted' || controller.signal.aborted) return

      // 9) Report to the CEO from the mirrored Kernel state.
      this.patch({ phase: 'reporting' })
      const report = await this.backends.statusReporter.report(
        {
          project: this.state.project ?? project,
          classification,
          breakdown,
          queue: this.state.queue,
          assignments: this.state.assignments,
          progress: this.state.progress ?? emptyProgress(projectId)
        },
        ctx
      )
      const settled = this.kernel.getState().projects.find((p) => p.id === projectId)
      const succeeded = settled?.state === 'completed'
      this.patch({ report, phase: succeeded ? 'done' : 'failed' })
      this.log('chief_of_staff', 'Status report ready for the CEO.')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.log('system', `Workflow stopped: ${message}`)
      this.patch({ phase: 'failed' })
    }
  }

  // ---- Kernel projection (Kernel = source of truth) ------------------------

  /** Mirror the Kernel's authoritative state into the CEO-facing projection. */
  private syncFromKernel(): void {
    if (!this.projectId) return
    const ks = this.kernel.getState()

    const kProject = ks.projects.find((p) => p.id === this.projectId)
    const project =
      this.state.project && kProject
        ? { ...this.state.project, phase: toProjectPhase(kProject.state) }
        : this.state.project

    const items: WorkItem[] = this.state.queue.items.map((wi) => {
      const task = ks.tasks.find((t) => t.id === wi.id)
      if (!task) return wi
      return {
        ...wi,
        state: toWorkItemState(task.state),
        progress: task.progress,
        assignedWorkerId: task.assignedWorkerId,
        note: task.note ?? wi.note
      }
    })

    const nameOf = (id: string): string =>
      ks.workers.find((w) => w.id === id)?.metadata.displayName ?? id
    const assignments: Assignment[] = ks.assignments.map((a) => ({
      workItemId: a.taskId,
      workItemTitle: items.find((i) => i.id === a.taskId)?.title ?? a.taskId,
      workerId: a.workerId,
      workerName: nameOf(a.workerId),
      role: a.capability,
      rationale: 'Assigned by the Kernel scheduler',
      confidence: 1
    }))

    this.patch({
      project,
      queue: { items },
      assignments,
      progress: computeProgress(this.projectId, items)
    })
  }

  /** Turn Kernel events into the CEO-facing action log + phase transitions. */
  private onKernelEvent(event: KernelEvent): void {
    switch (event.type) {
      case 'ProjectCreated':
        this.log('system', `Kernel created project “${event.name}”.`)
        break
      case 'WorkerAssigned':
        this.log(
          event.capability,
          `${event.workerName} assigned to “${this.titleFor(event.taskId)}”.`
        )
        break
      case 'TaskStarted':
        if (this.state.phase === 'assigning') this.patch({ phase: 'executing' })
        break
      case 'TaskCompleted':
        this.log(
          this.roleFor(event.taskId) ?? 'system',
          `Completed “${this.titleFor(event.taskId)}”.`
        )
        break
      case 'WorkerFailed':
        this.log(
          this.roleFor(event.taskId) ?? 'system',
          `Failed “${this.titleFor(event.taskId)}”: ${event.reason}.`
        )
        break
      case 'ProjectCompleted':
        this.log(
          'system',
          `Kernel settled the project (${event.succeeded ? 'succeeded' : 'with failures'}).`
        )
        break
      case 'ApprovalRequested':
        this.log('chief_of_staff', `Approval requested: ${event.title}.`)
        break
      // TaskQueued / TaskProgress are high-frequency; the mirrored state already
      // reflects them, so they are intentionally not logged line-by-line.
      default:
        break
    }
  }

  private titleFor(taskId: string): string {
    return this.state.queue.items.find((i) => i.id === taskId)?.title ?? taskId
  }

  private roleFor(taskId: string): CosLogActor | undefined {
    return this.state.queue.items.find((i) => i.id === taskId)?.role
  }

  // ---- Contexts + state helpers --------------------------------------------

  private actionContext(signal: AbortSignal): ActionContext {
    return {
      signal,
      log: (message) => this.log('chief_of_staff', message)
    }
  }

  private abortSignal(signal: AbortSignal): Promise<'aborted'> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve('aborted')
        return
      }
      signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    })
  }

  private patch(patch: Partial<ChiefOfStaffState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  private log(actor: CosLogActor, message: string): void {
    const entry = { id: this.id('log'), actor, message, at: this.elapsed() }
    this.state = { ...this.state, log: [...this.state.log, entry] }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private isBusy(): boolean {
    const done: CosPhase[] = ['idle', 'done', 'failed']
    return !done.includes(this.state.phase)
  }

  private id(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  private elapsed(): string {
    if (!this.startedAt) return '0.0s'
    return `${((Date.now() - this.startedAt) / 1000).toFixed(1)}s`
  }
}

// ---- Pure mapping helpers (Kernel domain → CEO projection) -----------------

function toWorkItemState(state: KernelTaskState): WorkItemState {
  switch (state) {
    case 'pending':
      return 'queued'
    case 'dispatched':
      return 'assigned'
    case 'running':
      return 'in_progress'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'blocked'
  }
}

function toProjectPhase(state: KernelProjectState): ProjectPhase {
  switch (state) {
    case 'active':
      return 'in_progress'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
  }
}

function toKernelPriority(priority: string): KernelPriority {
  switch (priority) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'high'
    case 'low':
      return 'low'
    default:
      return 'normal'
  }
}

function computeProgress(projectId: string, items: WorkItem[]): ProgressSnapshot {
  const total = items.length
  const done = items.filter((i) => i.state === 'done').length
  const inProgress = items.filter((i) => i.state === 'in_progress').length
  const queued = items.filter((i) => i.state === 'queued' || i.state === 'assigned').length
  const blocked = items.filter((i) => i.state === 'blocked').length
  const failed = items.filter((i) => i.state === 'failed').length
  const overall =
    total === 0 ? 0 : Math.round(items.reduce((s, i) => s + i.progress, 0) / total)
  return { projectId, overall, total, queued, inProgress, done, blocked, failed }
}

function emptyProgress(projectId: string): ProgressSnapshot {
  return {
    projectId,
    overall: 0,
    total: 0,
    queued: 0,
    inProgress: 0,
    done: 0,
    blocked: 0,
    failed: 0
  }
}
