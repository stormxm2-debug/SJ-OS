/**
 * Release Center — release-candidate types.
 *
 * SJ OS prepares, reviews, approves, and tracks release candidates before
 * deployment. These types are the shape of that release state, persisted
 * locally alongside the DevOS / PM Planner / CTO Room / Approval Center / QA
 * Center memory (no external API, no database).
 *
 * This is a self-contained local service in the same repository + event-bus +
 * persistence style as the QA Center and Approval Center. A snapshot holds a
 * newest-first list of releases (the history); releases[0] is the current
 * release candidate.
 */

/** Lifecycle status of a release candidate. */
export type ReleaseStatus =
  | 'draft'
  | 'qa-review'
  | 'approval-required'
  | 'ready'
  | 'released'
  | 'blocked'
  | 'cancelled'

/** What kind of release this is. */
export type ReleaseType = 'internal' | 'demo' | 'beta' | 'production' | 'hotfix'

/** Status of the build and QA gates. */
export type ReleaseGateStatus = 'pending' | 'passed' | 'failed' | 'warning'

/** Status of the approval gate. */
export type ReleaseApprovalStatus = 'not-required' | 'pending' | 'approved' | 'rejected'

/** Status of deployment. */
export type ReleaseDeploymentStatus = 'pending' | 'in-progress' | 'deployed' | 'failed'

/** A single item on the release checklist. */
export interface ReleaseChecklistItem {
  label: string
  done: boolean
}

/** A release candidate and its gates, checklist and notes. */
export interface ReleaseItem {
  releaseId: string
  title: string
  version: string
  status: ReleaseStatus
  releaseType: ReleaseType
  relatedSprint: string
  relatedEpic: string
  relatedFeatures: string[]
  /** Link to the QA run that gated this release (see QA Center). */
  qaRunId: string | null
  /** Link to the approval request for this release (see Approval Center). */
  approvalId: string | null
  buildStatus: ReleaseGateStatus
  qaStatus: ReleaseGateStatus
  approvalStatus: ReleaseApprovalStatus
  deploymentStatus: ReleaseDeploymentStatus
  releaseNotes: string
  blockers: string[]
  warnings: string[]
  checklist: ReleaseChecklistItem[]
  createdAt: string
  updatedAt: string
  /** Set once the candidate is released; null otherwise. */
  releasedAt: string | null
  /** DevOS worker id that owns the release (usually 'devops'). */
  ownerWorkerId: string
}

/** Kinds of events recorded in the persisted Release Center event log. */
export type ReleaseLogType =
  | 'release-created'
  | 'qa-reviewed'
  | 'approval-requested'
  | 'approval-received'
  | 'blocker-added'
  | 'blocker-cleared'
  | 'marked-ready'
  | 'released'
  | 'cancelled'
  | 'reset'

/** A single, human-readable entry in the persisted Release Center event log. */
export interface ReleaseLogEntry {
  id: string
  type: ReleaseLogType
  message: string
  createdAt: string
}

/** The full persisted Release Center snapshot. */
export interface ReleaseSnapshot {
  /** Newest-first list of releases. releases[0] is the current candidate. */
  releases: ReleaseItem[]
  /** Newest-first log of meaningful release changes (the release history). */
  eventLog: ReleaseLogEntry[]
}

/** Fields a caller supplies to create a new release candidate. */
export interface NewReleaseInput {
  title: string
  version: string
  releaseType: ReleaseType
  relatedSprint?: string
  relatedEpic?: string
  relatedFeatures?: string[]
  releaseNotes?: string
  ownerWorkerId?: string
}
