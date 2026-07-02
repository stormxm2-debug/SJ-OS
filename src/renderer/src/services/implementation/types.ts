/**
 * Implementation Request domain — Jarvis command-to-development types.
 *
 * When the CEO gives Jarvis a product/development command ("고객 워크스페이스에
 * 우선순위 뱃지 만들어"), Jarvis does NOT edit source files. Instead it creates a
 * structured Implementation Request and routes it safely through the existing SJ
 * OS development operating system — PM Planner, Approval Center, Development OS
 * and Autopilot. These types are the shape of that request queue, persisted
 * locally alongside the PM / DevOS / Approval memory (no external API, no
 * database, no git, no file edits).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the other SJ OS modules. All data is local;
 * it holds no real personal or sensitive information.
 */

/** Lifecycle of an implementation request. */
export type ImplementationStatus =
  | 'drafted'
  | 'planned'
  | 'waiting-for-approval'
  | 'approved'
  | 'promoted-to-devos'
  | 'in-progress'
  | 'completed'
  | 'rejected'
  | 'deferred'

/** Priority ladder, shared across SJ OS. */
export type ImplementationPriority = 'P0' | 'P1' | 'P2' | 'P3'

/** How risky the change is — drives approval routing. */
export type ImplementationRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** The SJ OS workspace an implementation request targets. */
export type TargetWorkspace =
  | 'fc-os'
  | 'customer'
  | 'sales-activity'
  | 'schedule'
  | 'performance'
  | 'team-leader'
  | 'consultation'
  | 'insurance-analysis'
  | 'jarvis'
  | 'autopilot'
  | 'company'
  | 'unknown'

/** A single structured implementation request raised by Jarvis. */
export interface ImplementationRequest {
  requestId: string
  title: string
  /** The exact command the CEO typed. */
  rawUserCommand: string
  /** Jarvis's local interpretation of the goal (no AI call). */
  interpretedGoal: string
  targetWorkspace: TargetWorkspace
  priority: ImplementationPriority
  status: ImplementationStatus
  requestedBy: string
  createdAt: string
  updatedAt: string
  /** PM Planner backlog item id created for this request (null until planned). */
  pmPlanId: string | null
  relatedEpic: string | null
  relatedFeature: string | null
  relatedTask: string | null
  approvalRequired: boolean
  /** Approval Center item id, once an approval was raised (null otherwise). */
  approvalId: string | null
  riskLevel: ImplementationRiskLevel
  nextAction: string
  /** Where this request currently routes to, e.g. "Approval Center", "Autopilot". */
  routeTarget: string
  /** Human-readable trail of the routing decisions taken. */
  routingLog: string[]
}

/** Kinds of events recorded in the persisted Implementation event log. */
export type ImplementationLogType =
  | 'created'
  | 'routed'
  | 'planned'
  | 'approval-requested'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'promoted-to-devos'
  | 'status-changed'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Implementation event log. */
export interface ImplementationLogEntry {
  id: string
  type: ImplementationLogType
  message: string
  createdAt: string
}

/** The full persisted Implementation Request snapshot. */
export interface ImplementationSnapshot {
  requests: ImplementationRequest[]
  /** Id of the request currently open in the detail panel (null = none). */
  selectedRequestId: string | null
  /** Newest-first log of meaningful Implementation changes. */
  eventLog: ImplementationLogEntry[]
}

/** Organization-wide implementation-request rollup. */
export interface ImplementationSummary {
  total: number
  drafted: number
  planned: number
  waitingForApproval: number
  approved: number
  promotedToDevos: number
  inProgress: number
  completed: number
  rejected: number
  deferred: number
  /** Requests ready for Autopilot to promote (approved, or planned & no approval). */
  readyToPromote: number
}

/** Fields a caller (Jarvis) supplies to raise a new implementation request. */
export interface NewImplementationInput {
  rawUserCommand: string
  interpretedGoal?: string
  targetWorkspace?: TargetWorkspace
  priority?: ImplementationPriority
  riskLevel?: ImplementationRiskLevel
  approvalRequired?: boolean
  requestedBy?: string
  title?: string
}
