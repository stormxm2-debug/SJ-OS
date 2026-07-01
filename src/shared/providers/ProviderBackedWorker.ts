import {
  inboxTopic,
  REPORT_TOPIC,
  type Capability,
  type DispatchCommand,
  type ExecutionStatus,
  type KernelWorkerRecord,
  type MessageBus,
  type Worker,
  type WorkerReport
} from '../kernel'
import type { WorkerRole } from '../types'
import type { CodingProvider } from './adapter'
import type { ProviderContext, ProviderPhase } from './types'
import {
  DefaultApprovalPolicy,
  reviewActions,
  type ApprovalPolicy
} from './approval'

/**
 * ProviderBackedWorker — the generic bridge between the Kernel and a provider.
 *
 * It IS a Kernel worker (communicates only over the Message Bus, including live
 * `phase` reports) but does none of the work itself: it delegates to an injected
 * `CodingProvider` and runs every proposed action past the Approval Policy. One
 * class backs every real worker on the floor — Research, CTO, Backend, Frontend,
 * Developer, QA, Git, … — differing only by the role/provider passed in.
 *
 * On completion it reports the REAL artifacts (files written) and the project
 * workspace back to the Kernel, so the CEO sees actual output.
 */
export interface ProviderBackedWorkerOptions {
  id: string
  role: WorkerRole
  displayName: string
  provider: CodingProvider
  policy?: ApprovalPolicy
}

export class ProviderBackedWorker implements Worker {
  readonly id: string
  readonly capabilities: Capability[]
  private readonly role: WorkerRole
  private readonly displayName: string
  private readonly provider: CodingProvider
  private readonly policy: ApprovalPolicy
  private readonly active = new Set<AbortController>()
  private seq = 0

  constructor(opts: ProviderBackedWorkerOptions) {
    this.id = opts.id
    this.role = opts.role
    this.capabilities = [opts.role]
    this.displayName = opts.displayName
    this.provider = opts.provider
    this.policy = opts.policy ?? new DefaultApprovalPolicy()
  }

  describe(): KernelWorkerRecord {
    return {
      id: this.id,
      capabilities: [...this.capabilities],
      departmentId: `dept-${this.role}`,
      state: 'idle',
      activity: 'idle',
      currentTaskId: null,
      metadata: {
        displayName: this.displayName,
        role: this.role,
        simulated: this.provider.simulated
      }
    }
  }

  connect(bus: MessageBus, clock: () => number): () => void {
    const unsubscribe = bus.subscribe<DispatchCommand>(inboxTopic(this.id), (m) => {
      void this.execute(m.payload, bus, clock)
    })
    return () => {
      unsubscribe()
      for (const controller of this.active) controller.abort()
      this.active.clear()
    }
  }

  private async execute(
    command: DispatchCommand,
    bus: MessageBus,
    clock: () => number
  ): Promise<void> {
    const controller = new AbortController()
    this.active.add(controller)
    const { taskId, projectId, projectName, title, capability } = command
    this.report(bus, clock, { kind: 'started', workerId: this.id, taskId })

    const ctx: ProviderContext = {
      signal: controller.signal,
      reportPhase: (phase) => this.reportPhase(bus, clock, taskId, phase),
      reportProgress: (percent) =>
        this.report(bus, clock, { kind: 'progress', workerId: this.id, taskId, progress: percent }),
      log: () => {
        /* provider logs stay internal; surfaced via artifacts/events instead */
      }
    }

    try {
      const result = await this.provider.execute(
        { taskId, projectId, projectName, title, capability },
        ctx
      )
      if (controller.signal.aborted) return

      if (!result.ok) {
        this.report(bus, clock, { kind: 'failed', workerId: this.id, taskId, reason: result.summary })
        return
      }

      const review = reviewActions(this.policy, result.actions)
      if (review.pending.length > 0) {
        this.reportPhase(bus, clock, taskId, 'waiting')
        this.report(bus, clock, {
          kind: 'failed',
          workerId: this.id,
          taskId,
          reason: `Requires CEO approval: ${review.pending.map((a) => a.description).join('; ')}`
        })
        return
      }

      const artifactNote =
        result.artifacts.length > 0 ? ` — ${result.artifacts.length} file(s)` : ''
      this.report(bus, clock, {
        kind: 'completed',
        workerId: this.id,
        taskId,
        summary: `${result.summary}${artifactNote}`,
        artifacts: result.artifacts,
        workspace: result.workspace || undefined,
        assets: result.assets.length > 0 ? result.assets : undefined
      })
    } catch {
      if (controller.signal.aborted) return
      this.report(bus, clock, { kind: 'failed', workerId: this.id, taskId, reason: 'Provider execution error' })
    } finally {
      this.active.delete(controller)
    }
  }

  /** Map a provider phase to this role's live execution status. */
  private reportPhase(
    bus: MessageBus,
    clock: () => number,
    taskId: string,
    phase: ProviderPhase | 'waiting'
  ): void {
    let status: ExecutionStatus
    if (phase === 'waiting') status = 'waiting'
    else if (phase === 'planning') status = 'planning'
    else if (phase === 'testing') status = 'testing'
    else status = this.role === 'research' ? 'researching' : this.role === 'qa' ? 'review' : 'coding'
    this.report(bus, clock, { kind: 'phase', workerId: this.id, taskId, phase: status })
  }

  private report(bus: MessageBus, clock: () => number, report: WorkerReport): void {
    this.seq += 1
    bus.publish(REPORT_TOPIC, report, `${this.id}-r${this.seq}`, clock())
  }
}
