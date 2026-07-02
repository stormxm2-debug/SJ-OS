export type CtoEventName = 'snapshot:updated' | 'room:updated'

export interface CtoEvent {
  type: CtoEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring PmEvents / DevOsEvents / CompanyEvents. */
export class CtoEvents {
  private listeners = new Set<(event: CtoEvent) => void>()

  subscribe(listener: (event: CtoEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: CtoEventName, payload?: unknown): void {
    const event: CtoEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
