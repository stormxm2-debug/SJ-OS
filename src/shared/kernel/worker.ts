import {
  inboxTopic,
  REPORT_TOPIC,
  type DispatchCommand,
  type MessageBus,
  type WorkerReport
} from './messageBus'
import type {
  Capability,
  ExecutionStatus,
  KernelWorkerRecord,
  WorkerMetadata
} from './types'

/**
 * Worker — the Kernel-facing worker abstraction.
 *
 * A worker connects to the Message Bus, listens on its own inbox for dispatch
 * commands, does the work, and publishes reports back. It NEVER references
 * another worker, the Kernel, or shared state — the Message Bus is its only
 * connection to the outside world. That is exactly the property that lets a
 * worker later run in another process or machine unchanged.
 *
 * `MockWorker` is a provider-neutral simulation (timers only — no OpenAI,
 * Claude, GitHub, Playwright, Python or browser). A real worker replaces the
 * `execute` body with a provider call while keeping this same contract.
 */
export interface Worker {
  readonly id: string
  readonly capabilities: Capability[]
  describe(): KernelWorkerRecord
  /** Attach to the bus; returns a detach function. Called by the Kernel. */
  connect(bus: MessageBus, clock: () => number): () => void
}

interface MockWorkerOptions {
  id: string
  capabilities: Capability[]
  metadata: WorkerMetadata
  /** The execution status this simulated worker reports while working. */
  phase?: ExecutionStatus
  /** Simulated work duration parameters. */
  steps?: number
  stepMs?: number
}

export class MockWorker implements Worker {
  readonly id: string
  readonly capabilities: Capability[]
  private readonly metadata: WorkerMetadata
  private readonly phase: ExecutionStatus
  private readonly steps: number
  private readonly stepMs: number
  private readonly timers = new Set<ReturnType<typeof setInterval>>()
  private seq = 0

  constructor(opts: MockWorkerOptions) {
    this.id = opts.id
    this.capabilities = [...opts.capabilities]
    this.metadata = opts.metadata
    this.phase = opts.phase ?? 'coding'
    this.steps = opts.steps ?? 5
    this.stepMs = opts.stepMs ?? 200
  }

  describe(): KernelWorkerRecord {
    return {
      id: this.id,
      capabilities: [...this.capabilities],
      departmentId: `dept-${this.capabilities[0]}`,
      state: 'idle',
      activity: 'idle',
      currentTaskId: null,
      metadata: { ...this.metadata }
    }
  }

  connect(bus: MessageBus, clock: () => number): () => void {
    const unsubscribe = bus.subscribe<DispatchCommand>(
      inboxTopic(this.id),
      (message) => this.execute(message.payload, bus, clock)
    )
    return () => {
      unsubscribe()
      for (const timer of this.timers) clearInterval(timer)
      this.timers.clear()
    }
  }

  private execute(
    command: DispatchCommand,
    bus: MessageBus,
    clock: () => number
  ): void {
    const { taskId } = command
    this.report(bus, clock, { kind: 'started', workerId: this.id, taskId })
    this.report(bus, clock, {
      kind: 'phase',
      workerId: this.id,
      taskId,
      phase: this.phase
    })

    let progress = 0
    const increment = Math.max(1, Math.round(100 / this.steps))
    const timer = setInterval(() => {
      progress = Math.min(100, progress + increment)
      if (progress < 100) {
        this.report(bus, clock, {
          kind: 'progress',
          workerId: this.id,
          taskId,
          progress
        })
        return
      }
      clearInterval(timer)
      this.timers.delete(timer)
      this.report(bus, clock, {
        kind: 'completed',
        workerId: this.id,
        taskId,
        summary: `${this.metadata.displayName} completed “${command.title}”.`
      })
    }, this.stepMs)
    this.timers.add(timer)
  }

  private report(
    bus: MessageBus,
    clock: () => number,
    report: WorkerReport
  ): void {
    this.seq += 1
    bus.publish(REPORT_TOPIC, report, `${this.id}-r${this.seq}`, clock())
  }
}
