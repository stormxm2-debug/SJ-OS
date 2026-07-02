export type ApprovalEventName = 'snapshot:updated' | 'approvals:updated'

export interface ApprovalEvent {
  type: ApprovalEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring CtoEvents / PmEvents / DevOsEvents. */
export class ApprovalEvents {
  private listeners = new Set<(event: ApprovalEvent) => void>()

  subscribe(listener: (event: ApprovalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: ApprovalEventName, payload?: unknown): void {
    const event: ApprovalEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
