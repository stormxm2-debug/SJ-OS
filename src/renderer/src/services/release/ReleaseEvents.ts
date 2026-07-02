export type ReleaseEventName = 'snapshot:updated' | 'release:updated'

export interface ReleaseEvent {
  type: ReleaseEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring QaEvents / ApprovalEvents / CtoEvents. */
export class ReleaseEvents {
  private listeners = new Set<(event: ReleaseEvent) => void>()

  subscribe(listener: (event: ReleaseEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: ReleaseEventName, payload?: unknown): void {
    const event: ReleaseEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
