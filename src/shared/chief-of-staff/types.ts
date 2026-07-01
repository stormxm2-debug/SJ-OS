import type { WorkerRole } from '../types'

/**
 * Domain data for the Chief of Staff — the company's first operational AI
 * employee. Pure, serializable data only: every value here can cross an IPC or
 * process boundary unchanged, so a mock implementation today and a Claude/
 * OpenAI/GitHub-backed implementation tomorrow exchange the exact same shapes.
 */

// ---- The CEO request -------------------------------------------------------

export interface CeoRequest {
  id: string
  text: string
  receivedAt: string
}

// ---- Classification (capabilities 3 + 4) -----------------------------------

export type RequestType =
  | 'new_project'
  | 'existing_project'
  | 'bug_fix'
  | 'improvement'
  | 'research'

export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type ProjectSize = 'XS' | 'S' | 'M' | 'L' | 'XL'

export interface Classification {
  type: RequestType
  priority: Priority
  size: ProjectSize
  /** How many feature areas the planner should produce. */
  featureCount: number
  /** Roles the work will require, derived from the request type. */
  requiredRoles: WorkerRole[]
  summary: string
  rationale: string
}

// ---- Project (capability 2) ------------------------------------------------

export type ProjectPhase =
  | 'created'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'failed'

export interface Project {
  id: string
  name: string
  description: string
  /** Bound version-control target. Null until a GitHub backend creates one. */
  repository: string | null
  phase: ProjectPhase
  createdAt: string
}

// ---- Work breakdown (capability 5) -----------------------------------------
// Epic → Features → Tasks → Subtasks

export interface Subtask {
  id: string
  title: string
}

export interface WbsTask {
  id: string
  title: string
  role: WorkerRole
  subtasks: Subtask[]
}

export interface Feature {
  id: string
  title: string
  tasks: WbsTask[]
}

export interface Epic {
  id: string
  title: string
  description: string
  features: Feature[]
}

export interface WorkBreakdown {
  epic: Epic
  featureCount: number
  taskCount: number
  subtaskCount: number
}

// ---- Work queue (capability 6) ---------------------------------------------

export type WorkItemState =
  | 'queued'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'failed'

export interface WorkItem {
  id: string
  title: string
  role: WorkerRole
  featureId: string
  taskId: string
  /** Ids of work items that must finish before this one may start. */
  dependsOn: string[]
  state: WorkItemState
  progress: number
  assignedWorkerId: string | null
  note: string | null
}

export interface WorkQueue {
  items: WorkItem[]
}

// ---- Assignment (capability 7) ---------------------------------------------

export interface WorkerAvailability {
  workerId: string
  name: string
  role: WorkerRole
  available: boolean
  workload: number
  /** 0..1 competence signal the assignment engine can weigh. */
  competence: number
}

export interface Assignment {
  workItemId: string
  workItemTitle: string
  workerId: string
  workerName: string
  role: WorkerRole
  rationale: string
  /** 0..1 — how strong the match is. */
  confidence: number
}

// ---- Progress (capability 8) -----------------------------------------------

export interface ProgressSnapshot {
  projectId: string
  overall: number
  total: number
  queued: number
  inProgress: number
  done: number
  blocked: number
  failed: number
}

// ---- Status report (capability 9) ------------------------------------------

export interface CeoStatusReport {
  projectId: string
  headline: string
  summary: string
  progress: number
  classification: string
  completed: string[]
  outstanding: string[]
  risks: string[]
  nextActions: string[]
  generatedAt: string
}
