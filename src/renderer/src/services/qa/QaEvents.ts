export type QaEventName = 'snapshot:updated' | 'qa:updated'

export interface QaEvent {
  type: QaEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring ApprovalEvents / CtoEvents / PmEvents. */
export class QaEvents {
  private listeners = new Set<(event: QaEvent) => void>()

  subscribe(listener: (event: QaEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: QaEventName, payload?: unknown): void {
    const event: QaEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
