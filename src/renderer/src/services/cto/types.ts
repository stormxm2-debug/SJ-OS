/**
 * CTO Room — technical governance types.
 *
 * SJ OS gives the CTO a control room that surfaces the company's technical
 * health: architecture health, technical debt, risks, blocked decisions, the
 * next technical priorities, and QA / DevOps / release readiness. These types
 * are the shape of that state, persisted locally alongside the Development OS
 * and PM Planner memory (no external API, no database).
 *
 * The CTO Room is a read-and-act surface: it summarises where the build stands
 * and lets the CTO promote the next priority into the active Development OS
 * session. It reuses the same repository + event-bus pattern as DevOS / PM.
 */

/** Priority ladder, shared with the PM Planner's PmPriority. */
export type CtoPriority = 'P0' | 'P1' | 'P2' | 'P3'

/** Severity used by technical debt and risks. */
export type CtoSeverity = 'low' | 'medium' | 'high' | 'critical'

/** Likelihood of a risk materialising. */
export type CtoLikelihood = 'low' | 'medium' | 'high'

/** Traffic-light health used by QA, DevOps and other rollups. */
export type CtoSignal = 'green' | 'yellow' | 'red'

/** Where a release stands on the path to shipping. */
export type ReleaseReadinessLevel = 'not_ready' | 'at_risk' | 'ready'

/** Architecture health — the headline technical-health score and context. */
export interface ArchitectureHealth {
  /** 0–100 overall architecture health. */
  score: number
  summary: string
  strengths: string[]
  concerns: string[]
}

/** A single item of technical debt the CTO is tracking. */
export interface TechnicalDebtItem {
  id: string
  title: string
  /** Area of the system, e.g. "DevOS", "Kernel", "Jarvis". */
  area: string
  severity: CtoSeverity
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
}

/** A tracked technical risk with a mitigation and current status. */
export interface RiskItem {
  id: string
  title: string
  area: string
  severity: CtoSeverity
  likelihood: CtoLikelihood
  mitigation: string
  status: 'open' | 'mitigated'
  createdAt: string
  updatedAt: string
}

/** A decision that is blocked pending a CEO/CTO call. */
export interface BlockedDecision {
  id: string
  title: string
  context: string
  /** Who needs to decide, e.g. "CEO", "CTO". */
  owner: string
  status: 'blocked' | 'cleared'
  createdAt: string
  updatedAt: string
}

/**
 * A queued technical priority. Promoting one pushes its epic/feature/task into
 * the active Development OS session (see CtoRepository.promoteNextPriority).
 */
export interface NextPriority {
  id: string
  title: string
  rationale: string
  priority: CtoPriority
  /** The DevOS session fields this priority becomes when promoted. */
  epic: string
  feature: string
  task: string
  nextAction: string
  createdAt: string
}

/** Release readiness rollup with a simple, human-readable checklist. */
export interface ReleaseReadiness {
  level: ReleaseReadinessLevel
  /** 0–100 confidence the current work is releasable. */
  score: number
  summary: string
  checklist: Array<{ label: string; done: boolean }>
}

/** QA status rollup. */
export interface QaStatus {
  signal: CtoSignal
  summary: string
  passingChecks: number
  totalChecks: number
  openIssues: number
}

/** DevOps status rollup. */
export interface DevOpsStatus {
  signal: CtoSignal
  summary: string
  typecheckPassing: boolean
  buildPassing: boolean
  pipeline: string
  lastDeploy: string
}

/** Kinds of events recorded in the persisted CTO Room event log. */
export type CtoLogType =
  | 'debt-added'
  | 'debt-resolved'
  | 'risk-added'
  | 'risk-mitigated'
  | 'decision-blocked'
  | 'decision-cleared'
  | 'priority-promoted'
  | 'reset'

/** A single, human-readable entry in the persisted CTO Room event log. */
export interface CtoLogEntry {
  id: string
  type: CtoLogType
  message: string
  createdAt: string
}

/** The full persisted CTO Room snapshot. */
export interface CtoSnapshot {
  /** Current sprint / active work, mirrored for a quick executive read. */
  currentSprint: string
  activeEpic: string
  activeFeature: string
  activeTask: string
  architectureHealth: ArchitectureHealth
  technicalDebtItems: TechnicalDebtItem[]
  riskItems: RiskItem[]
  blockedDecisions: BlockedDecision[]
  nextPriorities: NextPriority[]
  releaseReadiness: ReleaseReadiness
  qaStatus: QaStatus
  devOpsStatus: DevOpsStatus
  /** ISO timestamp of the last CTO review (updated when a priority is promoted). */
  lastReviewAt: string
  /** Newest-first log of meaningful CTO Room changes. */
  eventLog: CtoLogEntry[]
}
