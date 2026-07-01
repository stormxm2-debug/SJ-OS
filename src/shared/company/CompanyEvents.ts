export type CompanyEventName =
  | 'snapshot:updated'
  | 'fc:updated'
  | 'customer:updated'
  | 'policy:updated'
  | 'sales:updated'
  | 'appointment:updated'
  | 'task:updated'
  | 'notification:updated'
  | 'activity:updated'
  | 'kpi:updated'

export interface CompanyEvent {
  type: CompanyEventName
  payload?: unknown
  timestamp: string
}

export class CompanyEvents {
  private listeners = new Set<(event: CompanyEvent) => void>()

  subscribe(listener: (event: CompanyEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: CompanyEventName, payload?: unknown): void {
    const event: CompanyEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
