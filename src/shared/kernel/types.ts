import type { WorkerRole } from '../types'

/**
 * Company Kernel — domain types.
 *
 * The Kernel is the operating system of SJ AI Company and the single source of
 * truth. These types are pure, serializable data: no framework, no vendor, no
 * behaviour. Every value can cross an IPC/process/network boundary unchanged,
 * so the same shapes flow whether the Kernel runs in-renderer today, in the
 * Node main process next, or in a separate service later.
 */

/**
 * A capability is what a worker can do. Today it maps 1:1 to the six company
 * roles; the type is deliberately narrow-but-extensible so capabilities can
 * grow without any provider being named here.
 */
export type Capability = WorkerRole

/** Scheduling priority — pure ordering, no AI. */
export type Priority = 'low' | 'normal' | 'high' | 'critical'

export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0
}

// ---- Projects --------------------------------------------------------------

export type ProjectState = 'active' | 'completed' | 'failed'

export type BuildStatus = 'pending' | 'building' | 'passing' | 'failing'

export interface KernelProject {
  id: string
  name: string
  description: string
  state: ProjectState
  /** On-disk workspace path, set once real execution produces files. */
  workspace: string | null
  buildStatus: BuildStatus
  createdAt: number
}

/** A real artifact produced by actual execution (a file written to disk). */
export interface ProjectArtifact {
  id: string
  projectId: string
  path: string
  workerId: string
  capability: Capability
  at: number
}

// ---- Tasks -----------------------------------------------------------------

export type TaskState =
  | 'pending' // admitted, dependencies not yet satisfied or awaiting a worker
  | 'dispatched' // handed to a worker via the Message Bus, not yet started
  | 'running' // worker reported it started
  | 'completed'
  | 'failed'
  | 'blocked' // a dependency failed; this task can never run

export interface KernelTask {
  id: string
  projectId: string
  title: string
  capability: Capability
  priority: Priority
  dependsOn: string[]
  state: TaskState
  progress: number
  assignedWorkerId: string | null
  note: string | null
}

/** A task as submitted by the Chief of Staff — the Kernel owns it thereafter. */
export interface TaskSpec {
  id: string
  title: string
  capability: Capability
  priority?: Priority
  dependsOn?: string[]
}

/** The planning artefact the Chief of Staff hands the Kernel to admit a project. */
export interface ProjectPlan {
  name: string
  description: string
  tasks: TaskSpec[]
}

// ---- Workers ---------------------------------------------------------------

export type WorkerState = 'idle' | 'busy' | 'offline'

/**
 * Fine-grained, real execution status a worker reports as it progresses. This
 * is the truth shown on the Live Company View — it originates here, in the
 * Kernel, from what the worker actually reports over the Message Bus.
 */
export type ExecutionStatus =
  | 'idle'
  | 'meeting'
  | 'planning'
  | 'researching'
  | 'coding'
  | 'testing'
  | 'review'
  | 'waiting'
  | 'completed'
  | 'failed'

export interface WorkerMetadata {
  displayName: string
  role: WorkerRole
  /** True when this worker is a simulation (marked explicitly, per Sprint 4). */
  simulated: boolean
}

/** The Kernel's record of a worker. The Worker Registry owns these. */
export interface KernelWorkerRecord {
  id: string
  capabilities: Capability[]
  /** The department this worker belongs to. Many workers may share one. */
  departmentId: string
  state: WorkerState
  /** The worker's live execution status (real, reported by the worker). */
  activity: ExecutionStatus
  currentTaskId: string | null
  metadata: WorkerMetadata
}

// ---- Assignments -----------------------------------------------------------

export interface Assignment {
  taskId: string
  departmentId: string
  workerId: string
  capability: Capability
  assignedAt: number
}
