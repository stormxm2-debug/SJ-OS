/**
 * Live Company — unified company snapshot types.
 *
 * SJ OS aggregates every module the AI company runs on — Development OS, PM
 * Planner, CTO Room, Approval Center, QA Center, Release Center and DevOps
 * Center — into one live command-center snapshot. This is a read-only
 * projection computed from the other repositories; it owns no persisted state
 * of its own and requires no external API or database.
 */

import type { WorkerMemory } from '@renderer/services/devos/types'

/** One stage in the department delivery timeline. */
export interface DepartmentStage {
  key: string
  label: string
  status: string
  /** 0–100 progress for this stage. */
  progress: number
  owner: string
  latestEvent: string
  blockerCount: number
}

/** A single, source-tagged entry in the unified activity feed. */
export interface CompanyActivityEntry {
  id: string
  source: string
  message: string
  createdAt: string
}

/** Headline metrics surfaced on the command-center header. */
export interface CompanyMetrics {
  overallProgress: number
  architectureHealth: number
  openTechnicalDebt: number
  pendingApprovals: number
  qaWarnings: number
  releaseBlockers: number
  deploymentBlockers: number
}

/**
 * The unified company snapshot. Combines the single-source-of-truth fields the
 * whole company reads (sprint/epic/feature/task, status, progress, next action)
 * with the department timeline, worker activity and a merged activity feed.
 */
export interface CompanySnapshot {
  companyStatus: string
  currentSprint: string
  currentEpic: string
  currentFeature: string
  currentTask: string
  overallProgress: number
  activeDepartment: string
  activeWorker: string
  bottlenecks: string[]
  pendingApprovals: number
  qaWarnings: number
  releaseStatus: string
  deploymentStatus: string
  nextRecommendedAction: string
  lastUpdated: string
  /** PM → DevOS → CTO → Approval → QA → Release → DevOps delivery flow. */
  departments: DepartmentStage[]
  /** Live AI-worker memory (from the Development OS). */
  workers: WorkerMemory[]
  /** Newest-first merged feed across every module. */
  activity: CompanyActivityEntry[]
  metrics: CompanyMetrics
}
