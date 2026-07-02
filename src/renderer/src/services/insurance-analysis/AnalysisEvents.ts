export type AnalysisEventName = 'snapshot:updated' | 'analysis:updated' | 'selection:changed'

export interface AnalysisEvent {
  type: AnalysisEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring ConsultationEvents / ScheduleEvents. */
export class AnalysisEvents {
  private listeners = new Set<(event: AnalysisEvent) => void>()

  subscribe(listener: (event: AnalysisEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: AnalysisEventName, payload?: unknown): void {
    const event: AnalysisEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
