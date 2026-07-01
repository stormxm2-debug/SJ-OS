import {
  InMemoryEventBus,
  type EventBus,
  type EventListener,
  type KernelEvent
} from './events'
import {
  InMemoryMessageBus,
  REPORT_TOPIC,
  inboxTopic,
  type DispatchCommand,
  type MessageBus,
  type WorkerReport
} from './messageBus'
import { PriorityScheduler, type Scheduler } from './scheduler'
import { buildDepartments, type Department, type DepartmentView } from './department'
import { AssetStore } from './assetStore'
import { KernelState, isTerminal, type KernelStateSnapshot } from './state'
import { InMemoryWorkerRegistry, type WorkerRegistry } from './workerRegistry'
import { MeetingEngine } from './MeetingEngine'
import {
  createDefaultParticipants,
  type ConveneInput,
  type Meeting,
  type MeetingParticipant
} from './meeting'
import type { Worker } from './worker'
import type {
  Capability,
  KernelProject,
  KernelTask,
  ProjectPlan,
  TaskSpec
} from './types'

/** The replaceable modules the Kernel composes. Every one is an interface. */
export interface KernelModules {
  registry: WorkerRegistry
  scheduler: Scheduler
  messageBus: MessageBus
  eventBus: EventBus
  state: KernelState
  /** Meeting participants — provider-neutral strategies, LLM-backed later. */
  participants: MeetingParticipant[]
}

export function defaultModules(): KernelModules {
  return {
    registry: new InMemoryWorkerRegistry(),
    scheduler: new PriorityScheduler(),
    messageBus: new InMemoryMessageBus(),
    eventBus: new InMemoryEventBus(),
    state: new KernelState(),
    participants: createDefaultParticipants()
  }
}

/**
 * The Company Kernel — the operating system of SJ AI Company.
 *
 * It is the single source of truth and the single point of control. Nothing in
 * the company talks to a worker directly: the Chief of Staff admits work to the
 * Kernel; the Kernel schedules it, assigns a worker via the Registry, dispatches
 * over the Message Bus, records every fact on the Event Bus, and transitions
 * Kernel State as workers report back. Workers only ever see the Message Bus.
 *
 * The Kernel depends only on interfaces (`KernelModules`), so any part — the
 * transport, the registry, the scheduling policy — can be replaced for IPC,
 * multi-process or cloud deployment without touching this orchestration.
 */
export class CompanyKernel {
  private readonly registry: WorkerRegistry
  private readonly scheduler: Scheduler
  private readonly messageBus: MessageBus
  private readonly eventBus: EventBus
  private readonly state: KernelState
  private readonly meetingEngine: MeetingEngine
  private readonly departments: Department[]
  /** The Company Asset Store — permanent memory; survives reset(). */
  private readonly assetStore = new AssetStore()

  private readonly workers: Worker[]
  private readonly detachers: (() => void)[] = []
  private readonly listeners = new Set<() => void>()
  private readonly awaiters = new Map<string, ((p: KernelProject) => void)[]>()
  private readonly clock: () => number

  private snapshot: KernelStateSnapshot
  private seq = 0

  constructor(
    modules: KernelModules,
    workers: Worker[],
    clock: () => number = () => Date.now()
  ) {
    this.registry = modules.registry
    this.scheduler = modules.scheduler
    this.messageBus = modules.messageBus
    this.eventBus = modules.eventBus
    this.state = modules.state
    this.workers = workers
    this.clock = clock
    this.meetingEngine = new MeetingEngine(
      this.state,
      this.eventBus,
      this.registry,
      modules.participants,
      clock,
      { id: (p) => this.id(p), onChange: () => this.broadcast() }
    )

    // The Kernel listens for every worker report on the shared report topic.
    this.messageBus.subscribe<WorkerReport>(REPORT_TOPIC, (m) =>
      this.onReport(m.payload)
    )

    this.bootWorkers()
    // Group the roster into departments (one per capability today, many later).
    this.departments = buildDepartments(this.registry.all())
    this.snapshot = this.buildSnapshot()
  }

  // ---- Observation (single source of truth) --------------------------------

  getState = (): KernelStateSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Subscribe to the immutable event stream (audit trail). */
  onEvent(listener: EventListener): () => void {
    return this.eventBus.subscribe(listener)
  }

  // ---- Public API for the Chief of Staff -----------------------------------

  /** Open an AI meeting for a request. Runs asynchronously; resolves via
   *  `awaitMeeting`. Its decision drives the subsequent task breakdown. */
  convene(input: ConveneInput): string {
    return this.meetingEngine.convene(input)
  }

  awaitMeeting(meetingId: string): Promise<Meeting> {
    return this.meetingEngine.awaitMeeting(meetingId)
  }

  /** Admit a project: create it, queue its tasks, and start scheduling. */
  admit(plan: ProjectPlan): { projectId: string; taskIds: string[] } {
    const projectId = this.createProject(plan.name, plan.description)
    const taskIds = this.submitTasks(projectId, plan.tasks)
    return { projectId, taskIds }
  }

  createProject(name: string, description: string): string {
    const projectId = this.id('proj')
    this.state.addProject({
      id: projectId,
      name,
      description,
      state: 'active',
      workspace: null,
      buildStatus: 'pending',
      createdAt: this.clock()
    })
    this.eventBus.emit({
      type: 'ProjectCreated',
      projectId,
      name,
      ...this.stamp()
    })
    this.broadcast()
    return projectId
  }

  submitTasks(projectId: string, specs: TaskSpec[]): string[] {
    const ids: string[] = []
    for (const spec of specs) {
      const task: KernelTask = {
        id: spec.id,
        projectId,
        title: spec.title,
        capability: spec.capability,
        priority: spec.priority ?? 'normal',
        dependsOn: spec.dependsOn ?? [],
        state: 'pending',
        progress: 0,
        assignedWorkerId: null,
        note: null
      }
      this.state.addTask(task)
      ids.push(task.id)
      this.eventBus.emit({
        type: 'TaskQueued',
        projectId,
        taskId: task.id,
        title: task.title,
        capability: task.capability,
        ...this.stamp()
      })
    }
    this.broadcast()
    this.schedule()
    return ids
  }

  /** Resolves when the project reaches a terminal (settled) state. */
  awaitProject(projectId: string): Promise<KernelProject> {
    const project = this.state.getProject(projectId)
    if (project && project.state !== 'active') return Promise.resolve(project)
    return new Promise((resolve) => {
      const list = this.awaiters.get(projectId) ?? []
      list.push(resolve)
      this.awaiters.set(projectId, list)
    })
  }

  reset(): void {
    this.meetingEngine.cancel()
    this.detachWorkers()
    this.state.clear()
    this.eventBus.clear()
    this.awaiters.clear()
    for (const w of this.workers) {
      this.registry.setState(w.id, 'idle', null)
      this.registry.setActivity(w.id, 'idle')
    }
    this.bootWorkers()
    this.broadcast()
  }

  // ---- Scheduling + dispatch -----------------------------------------------

  private schedule(): void {
    // Schedule to DEPARTMENTS first; each department assigns one of its workers.
    const decisions = this.scheduler.plan(this.state.tasks(), this.departmentViews())
    for (const { taskId, departmentId, workerId } of decisions) {
      const task = this.state.getTask(taskId)
      const worker = this.registry.get(workerId)
      if (!task || !worker) continue

      this.state.updateTask(taskId, { state: 'dispatched', assignedWorkerId: workerId })
      this.registry.setState(workerId, 'busy', taskId)
      this.state.addAssignment({
        taskId,
        departmentId,
        workerId,
        capability: task.capability,
        assignedAt: this.clock()
      })
      this.eventBus.emit({
        type: 'WorkerAssigned',
        taskId,
        workerId,
        workerName: worker.metadata.displayName,
        capability: task.capability,
        ...this.stamp()
      })

      const command: DispatchCommand = {
        taskId,
        projectId: task.projectId,
        projectName: this.state.getProject(task.projectId)?.name ?? task.projectId,
        title: task.title,
        capability: task.capability,
        workerId
      }
      this.broadcast()
      // Dispatch strictly over the Message Bus — never a direct call.
      this.messageBus.publish(inboxTopic(workerId), command, this.id('msg'), this.clock())
    }
  }

  /** Each department with its currently-free workers, for the scheduler. */
  private departmentViews(): DepartmentView[] {
    const workers = this.registry.all()
    return this.departments.map((department) => ({
      department,
      idleWorkerIds: workers
        .filter((w) => w.departmentId === department.id && w.state === 'idle')
        .map((w) => w.id)
    }))
  }

  // ---- Worker reports (the only inbound worker channel) --------------------

  private onReport(report: WorkerReport): void {
    const task = this.state.getTask(report.taskId)
    if (!task) return

    switch (report.kind) {
      case 'started':
        this.state.updateTask(task.id, { state: 'running' })
        this.eventBus.emit({
          type: 'TaskStarted',
          taskId: task.id,
          workerId: report.workerId,
          ...this.stamp()
        })
        this.broadcast()
        break

      case 'phase':
        if (report.phase) this.registry.setActivity(report.workerId, report.phase)
        this.broadcast()
        break

      case 'progress':
        this.state.updateTask(task.id, { progress: clamp(report.progress ?? 0) })
        this.eventBus.emit({
          type: 'TaskProgress',
          taskId: task.id,
          workerId: report.workerId,
          progress: clamp(report.progress ?? 0),
          ...this.stamp()
        })
        this.broadcast()
        break

      case 'completed':
        this.state.updateTask(task.id, {
          state: 'completed',
          progress: 100,
          note: report.summary ?? null
        })
        this.registry.setActivity(report.workerId, 'completed')
        this.registry.setState(report.workerId, 'idle', null)
        this.recordArtifacts(task.projectId, task.capability, report)
        this.recordAssets(task.projectId, report)
        this.eventBus.emit({
          type: 'TaskCompleted',
          taskId: task.id,
          workerId: report.workerId,
          summary: report.summary ?? '',
          ...this.stamp()
        })
        this.afterTerminal(task.projectId)
        break

      case 'failed':
        this.state.updateTask(task.id, {
          state: 'failed',
          note: report.reason ?? 'failed'
        })
        this.registry.setActivity(report.workerId, 'failed')
        this.registry.setState(report.workerId, 'idle', null)
        this.eventBus.emit({
          type: 'WorkerFailed',
          taskId: task.id,
          workerId: report.workerId,
          reason: report.reason ?? 'failed',
          ...this.stamp()
        })
        this.afterTerminal(task.projectId)
        break
    }
  }

  /** Record the real files a completed task produced into project state. */
  private recordArtifacts(
    projectId: string,
    capability: Capability,
    report: WorkerReport
  ): void {
    if (report.workspace) this.state.setProjectWorkspace(projectId, report.workspace)
    if (!report.artifacts || report.artifacts.length === 0) return
    for (const path of report.artifacts) {
      this.state.addArtifact({
        id: this.id('art'),
        projectId,
        path,
        workerId: report.workerId,
        capability,
        at: this.clock()
      })
    }
    this.state.setProjectBuildStatus(projectId, 'building')
  }

  /** Register reusable assets a completed task produced into the Asset Store. */
  private recordAssets(projectId: string, report: WorkerReport): void {
    if (!report.assets || report.assets.length === 0) return
    const projectName = this.state.getProject(projectId)?.name ?? projectId
    for (const manifest of report.assets) {
      this.assetStore.register(manifest, projectName, this.id('asset'), this.clock())
    }
  }

  /** A task just finished: block unreachable work, reschedule, settle. */
  private afterTerminal(projectId: string): void {
    this.blockUnreachable(projectId)
    this.broadcast()
    this.schedule()
    this.settle(projectId)
  }

  /** Mark pending tasks whose dependencies failed/blocked as blocked. */
  private blockUnreachable(projectId: string): void {
    let changed = true
    while (changed) {
      changed = false
      const tasks = this.state.tasksForProject(projectId)
      const dead = new Set(
        tasks.filter((t) => t.state === 'failed' || t.state === 'blocked').map((t) => t.id)
      )
      for (const t of tasks) {
        if (t.state !== 'pending') continue
        if (t.dependsOn.some((d) => dead.has(d))) {
          this.state.updateTask(t.id, { state: 'blocked', note: 'Dependency did not complete' })
          changed = true
        }
      }
    }
  }

  private settle(projectId: string): void {
    if (!this.state.isProjectSettled(projectId)) return
    const project = this.state.getProject(projectId)
    if (!project || project.state !== 'active') return

    const tasks = this.state.tasksForProject(projectId)
    const succeeded = tasks.every((t) => t.state === 'completed')
    this.state.setProjectState(projectId, succeeded ? 'completed' : 'failed')
    this.state.setProjectBuildStatus(projectId, succeeded ? 'passing' : 'failing')
    if (succeeded) {
      const projectName = this.state.getProject(projectId)?.name ?? projectId
      this.assetStore.markProjectCompleted(projectName, this.clock())
    }
    this.eventBus.emit({
      type: 'ProjectCompleted',
      projectId,
      succeeded,
      ...this.stamp()
    })
    this.broadcast()

    const settled = this.state.getProject(projectId)
    const waiters = this.awaiters.get(projectId)
    if (settled && waiters) {
      this.awaiters.delete(projectId)
      for (const resolve of waiters) resolve(settled)
    }
  }

  // ---- Worker lifecycle ----------------------------------------------------

  private bootWorkers(): void {
    for (const worker of this.workers) {
      this.registry.register(worker.describe())
      this.detachers.push(worker.connect(this.messageBus, this.clock))
    }
  }

  private detachWorkers(): void {
    for (const detach of this.detachers) detach()
    this.detachers.length = 0
  }

  // ---- Snapshot + notification ---------------------------------------------

  private broadcast(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }

  private buildSnapshot(): KernelStateSnapshot {
    return {
      meetings: this.state.meetings(),
      departments: this.departments.map((d) => ({ ...d, workerIds: [...d.workerIds] })),
      projects: this.state.projects(),
      tasks: this.state.tasks(),
      workers: this.registry.all(),
      assignments: this.state.assignments(),
      artifacts: this.state.artifacts(),
      assets: this.assetStore.all(),
      events: [...this.eventBus.history()]
    }
  }

  private stamp(): { id: string; at: number } {
    return { id: this.id('evt'), at: this.clock() }
  }

  private id(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export { isTerminal }
