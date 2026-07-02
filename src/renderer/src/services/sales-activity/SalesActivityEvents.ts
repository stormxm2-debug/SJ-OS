export type SalesActivityEventName = 'snapshot:updated' | 'activity:updated' | 'selection:changed'

export interface SalesActivityEvent {
  type: SalesActivityEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring CustomerEvents / FcEvents. */
export class SalesActivityEvents {
  private listeners = new Set<(event: SalesActivityEvent) => void>()

  subscribe(listener: (event: SalesActivityEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: SalesActivityEventName, payload?: unknown): void {
    const event: SalesActivityEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
