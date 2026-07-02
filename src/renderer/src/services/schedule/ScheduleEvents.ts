export type ScheduleEventName = 'snapshot:updated' | 'item:updated' | 'selection:changed'

export interface ScheduleEvent {
  type: ScheduleEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring SalesActivityEvents / CustomerEvents. */
export class ScheduleEvents {
  private listeners = new Set<(event: ScheduleEvent) => void>()

  subscribe(listener: (event: ScheduleEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: ScheduleEventName, payload?: unknown): void {
    const event: ScheduleEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
