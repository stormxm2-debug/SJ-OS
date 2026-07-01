/**
 * Development Operating System — memory types.
 *
 * SJ OS remembers development state (sprint/epic/feature/task) and per-worker
 * memory locally, without relying on chat history or an external API. These
 * types are the shape of that persisted memory.
 */

export type DevSessionStatus = 'active' | 'blocked' | 'paused' | 'completed'

/** The single source of truth for "what the company is working on right now". */
export interface DevSession {
  currentSprint: string
  currentEpic: string
  currentFeature: string
  currentTask: string
  /** 0–100 completion of the current task/feature. */
  progress: number
  status: DevSessionStatus
  startedAt: string
  updatedAt: string
  /** Populated only when status is 'blocked'. */
  blockedReason: string | null
  /** The next concrete step the company should take. */
  nextAction: string
}

export type WorkerDepartment =
  | 'Executive'
  | 'Product'
  | 'Architecture'
  | 'Engineering'
  | 'Quality'
  | 'Operations'
  | 'Platform'

/** Independent memory for a single AI worker. */
export interface WorkerMemory {
  workerId: string
  name: string
  role: string
  department: WorkerDepartment
  /** The one thing this worker is doing now (empty string if idle). */
  currentWork: string
  completedWork: string[]
  blockedWork: string[]
  nextWork: string[]
  /** Self-reported confidence in current work, 0–100. */
  confidence: number
  lastUpdated: string
}

/** The full persisted Development OS memory snapshot. */
export interface DevOsSnapshot {
  session: DevSession
  workers: WorkerMemory[]
}
