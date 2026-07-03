export type DeveloperPromptEventName = 'snapshot:updated' | 'packet:updated' | 'selection:changed'

export interface DeveloperPromptEvent {
  type: DeveloperPromptEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring the other SJ OS service event buses. */
export class DeveloperPromptEvents {
  private listeners = new Set<(event: DeveloperPromptEvent) => void>()

  subscribe(listener: (event: DeveloperPromptEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: DeveloperPromptEventName, payload?: unknown): void {
    const event: DeveloperPromptEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
