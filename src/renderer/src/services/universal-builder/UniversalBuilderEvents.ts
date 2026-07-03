export type UniversalBuilderEventName = 'snapshot:updated' | 'project:updated' | 'selection:changed'

export interface UniversalBuilderEvent {
  type: UniversalBuilderEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring the other SJ OS service event buses. */
export class UniversalBuilderEvents {
  private listeners = new Set<(event: UniversalBuilderEvent) => void>()

  subscribe(listener: (event: UniversalBuilderEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: UniversalBuilderEventName, payload?: unknown): void {
    const event: UniversalBuilderEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
