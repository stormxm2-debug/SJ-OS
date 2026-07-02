/**
 * Approval Center — CEO decision types.
 *
 * SJ OS routes AI-company decisions that need human sign-off into an approval
 * queue the CEO can approve, reject, or defer. These types are the shape of
 * that queue, persisted locally alongside the DevOS / PM Planner / CTO Room
 * memory (no external API, no database).
 *
 * This is a self-contained local service in the same repository + event-bus +
 * persistence style as the CTO Room and PM Planner — it does not touch the
 * shared CompanyRepository or the legacy company ApprovalService.
 */

/** Where an approval stands. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'deferred'

/** The recorded decision once an item leaves 'pending' (null while pending). */
export type ApprovalDecision = 'approved' | 'rejected' | 'deferred' | null

/** The class of decision — drives grouping and colour. */
export type ApprovalCategory =
  | 'architecture'
  | 'product'
  | 'release'
  | 'customer-data'
  | 'finance'
  | 'insurance-analysis'
  | 'automation'
  | 'legal-risk'
  | 'external-api'
  | 'destructive-operation'

/** Priority ladder, shared with the rest of SJ OS. */
export type ApprovalPriority = 'P0' | 'P1' | 'P2' | 'P3'

/** How risky the decision is. */
export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** A single decision awaiting (or having received) CEO sign-off. */
export interface ApprovalItem {
  approvalId: string
  title: string
  description: string
  category: ApprovalCategory
  /** DevOS worker id that raised the request (see DevOS roster). */
  requestedByWorkerId: string
  requestedByRole: string
  /** Human-readable origin, e.g. "CTO Room", "PM Planner", "Manual". */
  source: string
  priority: ApprovalPriority
  status: ApprovalStatus
  decision: ApprovalDecision
  decisionReason: string | null
  createdAt: string
  updatedAt: string
  /** Set once a decision is made; null while pending. */
  decidedAt: string | null
  relatedEpic: string | null
  relatedFeature: string | null
  relatedTask: string | null
  riskLevel: ApprovalRiskLevel
  impactSummary: string
}

/** Kinds of events recorded in the persisted Approval Center event log. */
export type ApprovalLogType =
  | 'created'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'reason-added'
  | 'reason-cleared'
  | 'imported'
  | 'reset'

/** A single, human-readable entry in the persisted Approval Center event log. */
export interface ApprovalLogEntry {
  id: string
  type: ApprovalLogType
  message: string
  createdAt: string
}

/** The full persisted Approval Center snapshot. */
export interface ApprovalSnapshot {
  approvals: ApprovalItem[]
  /** Newest-first log of meaningful approval changes (the decision history). */
  eventLog: ApprovalLogEntry[]
}

/** Fields a caller supplies to create a new approval request. */
export interface NewApprovalInput {
  title: string
  description?: string
  category: ApprovalCategory
  requestedByWorkerId?: string
  requestedByRole?: string
  source?: string
  priority?: ApprovalPriority
  riskLevel?: ApprovalRiskLevel
  impactSummary?: string
  relatedEpic?: string | null
  relatedFeature?: string | null
  relatedTask?: string | null
}
