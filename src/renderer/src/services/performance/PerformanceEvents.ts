export type PerformanceEventName = 'snapshot:updated' | 'view:changed'

export interface PerformanceEvent {
  type: PerformanceEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring ScheduleEvents / SalesActivityEvents. */
export class PerformanceEvents {
  private listeners = new Set<(event: PerformanceEvent) => void>()

  subscribe(listener: (event: PerformanceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: PerformanceEventName, payload?: unknown): void {
    const event: PerformanceEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
