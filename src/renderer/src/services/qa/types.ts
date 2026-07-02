/**
 * QA Center — quality & release-gate types.
 *
 * SJ OS runs verification passes (typecheck, build, regression, security,
 * performance, coverage) and gates releases behind them. These types are the
 * shape of that QA state, persisted locally alongside the DevOS / PM Planner /
 * CTO Room / Approval Center memory (no external API, no database).
 *
 * This is a self-contained local service in the same repository + event-bus +
 * persistence style as the Approval Center and CTO Room. A snapshot holds a
 * newest-first list of QA runs (the history); runs[0] is the latest run.
 */

/** Status of a QA run, and of each verification dimension within it. */
export type QaStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'warning'

/** What a QA run covers. */
export type QaScope =
  | 'full-app'
  | 'frontend'
  | 'backend'
  | 'jarvis'
  | 'devos'
  | 'pm-planner'
  | 'cto-room'
  | 'approval-center'
  | 'insurance-platform'
  | 'release-candidate'

/** A single verification pass over some scope of the system. */
export interface QaRun {
  qaRunId: string
  title: string
  scope: QaScope
  status: QaStatus
  typecheckStatus: QaStatus
  buildStatus: QaStatus
  regressionStatus: QaStatus
  securityStatus: QaStatus
  performanceStatus: QaStatus
  coverageStatus: QaStatus
  releaseBlockers: string[]
  warnings: string[]
  passedChecks: string[]
  failedChecks: string[]
  startedAt: string
  /** Set once the run reaches a terminal status; null while pending/running. */
  completedAt: string | null
  /** DevOS worker id that owns the run (usually 'qa'). */
  ownerWorkerId: string
  relatedEpic: string | null
  relatedFeature: string | null
  relatedTask: string | null
}

/** Kinds of events recorded in the persisted QA Center event log. */
export type QaLogType =
  | 'run-created'
  | 'run-passed'
  | 'run-failed'
  | 'check-passed'
  | 'check-failed'
  | 'warning-added'
  | 'warning-cleared'
  | 'blocker-added'
  | 'blocker-cleared'
  | 'escalated'
  | 'reset'

/** A single, human-readable entry in the persisted QA Center event log. */
export interface QaLogEntry {
  id: string
  type: QaLogType
  message: string
  createdAt: string
}

/** The full persisted QA Center snapshot. */
export interface QaSnapshot {
  /** Newest-first list of QA runs. runs[0] is the latest run. */
  runs: QaRun[]
  /** Newest-first log of meaningful QA changes (the QA history). */
  eventLog: QaLogEntry[]
}

/** Fields a caller supplies to create a new QA run. */
export interface NewQaRunInput {
  title: string
  scope: QaScope
  ownerWorkerId?: string
  relatedEpic?: string | null
  relatedFeature?: string | null
  relatedTask?: string | null
}
