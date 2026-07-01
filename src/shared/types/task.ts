import type { WorkerRole } from './worker'

export type TaskState =
  | 'pending'
  | 'in_progress'
  | 'awaiting_approval'
  | 'done'
  | 'failed'

export interface Task {
  id: string
  title: string
  projectId: string
  assignedRole: WorkerRole
  state: TaskState
  progress: number
}
