export type ConsultationEventName = 'snapshot:updated' | 'consultation:updated' | 'selection:changed'

export interface ConsultationEvent {
  type: ConsultationEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring TeamLeaderEvents / ScheduleEvents. */
export class ConsultationEvents {
  private listeners = new Set<(event: ConsultationEvent) => void>()

  subscribe(listener: (event: ConsultationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: ConsultationEventName, payload?: unknown): void {
    const event: ConsultationEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
