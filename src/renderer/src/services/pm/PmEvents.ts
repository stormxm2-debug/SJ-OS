export type PmEventName = 'snapshot:updated' | 'plan:updated'

export interface PmEvent {
  type: PmEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring DevOsEvents / CompanyEvents. */
export class PmEvents {
  private listeners = new Set<(event: PmEvent) => void>()

  subscribe(listener: (event: PmEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: PmEventName, payload?: unknown): void {
    const event: PmEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
