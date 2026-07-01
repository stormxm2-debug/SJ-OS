export type DevOsEventName = 'snapshot:updated' | 'session:updated' | 'worker:updated'

export interface DevOsEvent {
  type: DevOsEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring CompanyEvents. */
export class DevOsEvents {
  private listeners = new Set<(event: DevOsEvent) => void>()

  subscribe(listener: (event: DevOsEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: DevOsEventName, payload?: unknown): void {
    const event: DevOsEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
