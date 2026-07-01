import type { AssetManifest } from './asset'
import type { Capability, ExecutionStatus } from './types'

/**
 * Message Bus — the ONLY channel through which workers communicate.
 *
 * Workers never call each other and never call the Kernel directly. They
 * publish messages to topics and subscribe to topics. The Kernel publishes
 * dispatch commands to a worker's inbox topic; workers publish their reports to
 * a shared report topic the Kernel listens on. Decoupling is total: a publisher
 * has no reference to any subscriber.
 *
 * In-memory today; a real transport (IPC channel, WebSocket, message broker)
 * fulfils the same publish/subscribe contract with no change to callers.
 */

export interface Message<T = unknown> {
  readonly id: string
  readonly topic: string
  readonly payload: T
  readonly at: number
}

export type MessageHandler<T = unknown> = (message: Message<T>) => void

export interface MessageBus {
  publish<T>(topic: string, payload: T, id: string, at: number): void
  subscribe<T>(topic: string, handler: MessageHandler<T>): () => void
  clear(): void
}

/** Default in-memory Message Bus. Replaceable by a real transport. */
export class InMemoryMessageBus implements MessageBus {
  private readonly handlers = new Map<string, Set<MessageHandler>>()

  publish<T>(topic: string, payload: T, id: string, at: number): void {
    const set = this.handlers.get(topic)
    if (!set) return
    const message: Message<T> = { id, topic, payload, at }
    for (const handler of set) (handler as MessageHandler<T>)(message)
  }

  subscribe<T>(topic: string, handler: MessageHandler<T>): () => void {
    let set = this.handlers.get(topic)
    if (!set) {
      set = new Set()
      this.handlers.set(topic, set)
    }
    set.add(handler as MessageHandler)
    return () => {
      set?.delete(handler as MessageHandler)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}

// ---- Topic scheme + message payloads --------------------------------------
// Centralised so producers and consumers cannot drift apart.

/** The Kernel dispatches work to a specific worker's inbox. */
export function inboxTopic(workerId: string): string {
  return `worker.inbox.${workerId}`
}

/** All workers report back on one shared topic the Kernel subscribes to. */
export const REPORT_TOPIC = 'worker.report'

/** Command: the Kernel tells a worker to execute a task. */
export interface DispatchCommand {
  taskId: string
  projectId: string
  projectName: string
  title: string
  capability: Capability
  workerId: string
}

export type WorkerReportKind =
  | 'started'
  | 'phase'
  | 'progress'
  | 'completed'
  | 'failed'

/** Report: a worker tells the Kernel what happened. */
export interface WorkerReport {
  kind: WorkerReportKind
  workerId: string
  taskId: string
  /** Present on 'phase' reports — the worker's live execution status. */
  phase?: ExecutionStatus
  progress?: number
  summary?: string
  reason?: string
  /** Present on 'completed' reports from real execution — files written. */
  artifacts?: string[]
  /** The project workspace path, reported alongside artifacts. */
  workspace?: string
  /** Reusable assets produced by this work, if any. */
  assets?: AssetManifest[]
}
