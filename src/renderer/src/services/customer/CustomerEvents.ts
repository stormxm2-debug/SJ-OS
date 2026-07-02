export type CustomerEventName = 'snapshot:updated' | 'customer:updated' | 'selection:changed'

export interface CustomerEvent {
  type: CustomerEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring FcEvents / DevOsEvents. */
export class CustomerEvents {
  private listeners = new Set<(event: CustomerEvent) => void>()

  subscribe(listener: (event: CustomerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: CustomerEventName, payload?: unknown): void {
    const event: CustomerEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
