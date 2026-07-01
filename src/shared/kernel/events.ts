import type { Capability } from './types'
import type { MeetingPhase, MeetingRole } from './meeting'

/**
 * Event Bus — immutable domain events.
 *
 * Events are FACTS: something that already happened, recorded once, never
 * mutated. They are the Kernel's audit trail and the way any observer (the
 * Chief of Staff, the UI, a future logger or remote mirror) learns what the
 * Kernel did — without reaching into Kernel internals. Emitting an event and
 * subscribing to events is the ONLY read-path for "what just happened".
 *
 * The in-memory bus here is trivially replaceable by a real broker (NATS,
 * Kafka, a WebSocket fan-out) because the contract is just emit/subscribe over
 * plain-data events.
 */

export type KernelEventType =
  | 'MeetingCreated'
  | 'MeetingOpinion'
  | 'MeetingPhaseChanged'
  | 'MeetingConcluded'
  | 'ProjectCreated'
  | 'TaskQueued'
  | 'WorkerAssigned'
  | 'TaskStarted'
  | 'TaskProgress'
  | 'TaskCompleted'
  | 'WorkerFailed'
  | 'ProjectCompleted'
  | 'ApprovalRequested'

interface BaseEvent {
  readonly id: string
  readonly at: number
}

export interface MeetingCreatedEvent extends BaseEvent {
  readonly type: 'MeetingCreated'
  readonly meetingId: string
  readonly request: string
}

export interface MeetingOpinionEvent extends BaseEvent {
  readonly type: 'MeetingOpinion'
  readonly meetingId: string
  readonly role: MeetingRole
  readonly summary: string
}

export interface MeetingPhaseChangedEvent extends BaseEvent {
  readonly type: 'MeetingPhaseChanged'
  readonly meetingId: string
  readonly phase: MeetingPhase
}

export interface MeetingConcludedEvent extends BaseEvent {
  readonly type: 'MeetingConcluded'
  readonly meetingId: string
  readonly approved: boolean
}

export interface ProjectCreatedEvent extends BaseEvent {
  readonly type: 'ProjectCreated'
  readonly projectId: string
  readonly name: string
}

export interface TaskQueuedEvent extends BaseEvent {
  readonly type: 'TaskQueued'
  readonly projectId: string
  readonly taskId: string
  readonly title: string
  readonly capability: Capability
}

export interface WorkerAssignedEvent extends BaseEvent {
  readonly type: 'WorkerAssigned'
  readonly taskId: string
  readonly workerId: string
  readonly workerName: string
  readonly capability: Capability
}

export interface TaskStartedEvent extends BaseEvent {
  readonly type: 'TaskStarted'
  readonly taskId: string
  readonly workerId: string
}

export interface TaskProgressEvent extends BaseEvent {
  readonly type: 'TaskProgress'
  readonly taskId: string
  readonly workerId: string
  readonly progress: number
}

export interface TaskCompletedEvent extends BaseEvent {
  readonly type: 'TaskCompleted'
  readonly taskId: string
  readonly workerId: string
  readonly summary: string
}

export interface WorkerFailedEvent extends BaseEvent {
  readonly type: 'WorkerFailed'
  readonly taskId: string
  readonly workerId: string
  readonly reason: string
}

export interface ProjectCompletedEvent extends BaseEvent {
  readonly type: 'ProjectCompleted'
  readonly projectId: string
  readonly succeeded: boolean
}

export interface ApprovalRequestedEvent extends BaseEvent {
  readonly type: 'ApprovalRequested'
  readonly taskId: string
  readonly title: string
}

export type KernelEvent =
  | MeetingCreatedEvent
  | MeetingOpinionEvent
  | MeetingPhaseChangedEvent
  | MeetingConcludedEvent
  | ProjectCreatedEvent
  | TaskQueuedEvent
  | WorkerAssignedEvent
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | WorkerFailedEvent
  | ProjectCompletedEvent
  | ApprovalRequestedEvent

export type EventListener = (event: KernelEvent) => void

export interface EventBus {
  emit(event: KernelEvent): void
  subscribe(listener: EventListener): () => void
  history(): readonly KernelEvent[]
  clear(): void
}

/** Default in-memory Event Bus. Replaceable by a real broker. */
export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Set<EventListener>()
  private readonly log: KernelEvent[] = []

  emit(event: KernelEvent): void {
    this.log.push(event)
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  history(): readonly KernelEvent[] {
    return this.log
  }

  clear(): void {
    this.log.length = 0
  }
}
