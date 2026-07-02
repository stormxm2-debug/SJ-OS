export type FcEventName = 'snapshot:updated' | 'member:updated' | 'roster:updated'

export interface FcEvent {
  type: FcEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring DevOsEvents / CompanyEvents. */
export class FcEvents {
  private listeners = new Set<(event: FcEvent) => void>()

  subscribe(listener: (event: FcEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: FcEventName, payload?: unknown): void {
    const event: FcEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
