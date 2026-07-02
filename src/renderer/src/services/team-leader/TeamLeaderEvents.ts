export type TeamLeaderEventName = 'snapshot:updated' | 'team:selected'

export interface TeamLeaderEvent {
  type: TeamLeaderEventName
  payload?: unknown
  timestamp: string
}

/** Minimal in-memory pub/sub, mirroring PerformanceEvents / ScheduleEvents. */
export class TeamLeaderEvents {
  private listeners = new Set<(event: TeamLeaderEvent) => void>()

  subscribe(listener: (event: TeamLeaderEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: TeamLeaderEventName, payload?: unknown): void {
    const event: TeamLeaderEvent = { type, payload, timestamp: new Date().toISOString() }
    this.listeners.forEach((listener) => listener(event))
  }
}
