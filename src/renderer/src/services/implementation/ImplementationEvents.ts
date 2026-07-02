export type ImplementationEventName = 'snapshot:updated' | 'request:updated' | 'selection:changed'

export interface ImplementationEvent {
  type: ImplementationEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring the other SJ OS service event buses. */
export class ImplementationEvents {
  private listeners = new Set<(event: ImplementationEvent) => void>()

  subscribe(listener: (event: ImplementationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: ImplementationEventName, payload?: unknown): void {
    const event: ImplementationEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
