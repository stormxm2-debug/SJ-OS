import type { WorkerRole } from './worker'

export type ActivityActor = WorkerRole | 'ceo' | 'system'

export interface ActivityEvent {
  id: string
  actor: ActivityActor
  summary: string
  createdAt: string
}
