/** The worker roles of the AI company. */
export type WorkerRole =
  | 'cto'
  | 'research'
  | 'frontend'
  | 'backend'
  | 'developer'
  | 'qa'
  | 'git'
  | 'documentation'
  | 'release'

export type WorkerStatus = 'idle' | 'working' | 'review' | 'blocked' | 'offline'

/**
 * A member of the AI engineering company as shown on the CEO Dashboard.
 * `avatar` is a provider-neutral key (e.g. initials/asset id) — no vendor is
 * encoded here, so the model behind a worker can change freely.
 */
export interface Worker {
  id: string
  name: string
  title: string
  role: WorkerRole
  avatar: string
  status: WorkerStatus
  currentTask: string | null
  progress: number
  lastActivity: string
}
