export type DevOpsEventName = 'snapshot:updated' | 'devops:updated'

export interface DevOpsEvent {
  type: DevOpsEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring ReleaseEvents / QaEvents / ApprovalEvents. */
export class DevOpsEvents {
  private listeners = new Set<(event: DevOpsEvent) => void>()

  subscribe(listener: (event: DevOpsEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: DevOpsEventName, payload?: unknown): void {
    const event: DevOpsEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
