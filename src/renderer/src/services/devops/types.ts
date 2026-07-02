/**
 * DevOps Center — deployment & operations types.
 *
 * SJ OS inspects Git status, build artifacts, deployment readiness, release
 * tags, environment status, deployment logs, rollback plans and operational
 * health around a release. These types are the shape of that DevOps state,
 * persisted locally alongside the DevOS / PM Planner / CTO Room / Approval /
 * QA / Release memory (no external API, no database).
 *
 * This is a self-contained local service in the same repository + event-bus +
 * persistence style as the Release Center and QA Center. A snapshot holds a
 * newest-first list of deployments (the history); deployments[0] is the current
 * deployment candidate.
 *
 * Note: this is the DevOps Center (deployments & operations). It is distinct
 * from the Development OS ("DevOS") service, which owns the dev session and
 * worker memory.
 */

/** Lifecycle status of a deployment candidate. */
export type DeploymentStatus =
  | 'draft'
  | 'ready'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'rolled-back'
  | 'blocked'

/** Target environments. */
export type DeploymentEnvironment = 'local' | 'development' | 'staging' | 'production'

/** Status of the build and QA gates. */
export type DevOpsGateStatus = 'pending' | 'passed' | 'failed' | 'warning'

/** Status of the approval gate. */
export type DevOpsApprovalStatus = 'not-required' | 'pending' | 'approved' | 'rejected'

/** Short pipeline status mirrored from the lifecycle. */
export type DevOpsPipelineStatus = 'pending' | 'in-progress' | 'deployed' | 'failed' | 'rolled-back'

/** Status of the build artifact. */
export type ArtifactStatus = 'pending' | 'building' | 'ready' | 'failed'

/** Operational health of the deployed environment. */
export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down'

/** A single item on the deployment checklist. */
export interface DeploymentChecklistItem {
  label: string
  done: boolean
}

/** A single deployment log line. */
export interface DeploymentLogEntry {
  id: string
  message: string
  createdAt: string
}

/** A deployment candidate and its gates, checklist, logs and rollback plan. */
export interface DeploymentItem {
  deploymentId: string
  title: string
  environment: DeploymentEnvironment
  status: DeploymentStatus
  /** Link to the release being deployed (see Release Center). */
  releaseId: string | null
  version: string
  gitBranch: string
  gitCommit: string
  buildStatus: DevOpsGateStatus
  qaStatus: DevOpsGateStatus
  approvalStatus: DevOpsApprovalStatus
  deploymentStatus: DevOpsPipelineStatus
  artifactStatus: ArtifactStatus
  healthStatus: HealthStatus
  rollbackPlan: string
  deploymentLogs: DeploymentLogEntry[]
  blockers: string[]
  warnings: string[]
  checklist: DeploymentChecklistItem[]
  startedAt: string
  /** Set once the deployment reaches a terminal status; null otherwise. */
  completedAt: string | null
  /** DevOS worker id that owns the deployment (usually 'devops'). */
  ownerWorkerId: string
}

/** Kinds of events recorded in the persisted DevOps Center event log. */
export type DevOpsLogType =
  | 'deployment-created'
  | 'artifact-ready'
  | 'environment-ready'
  | 'deployment-started'
  | 'deployment-succeeded'
  | 'deployment-failed'
  | 'log-added'
  | 'blocker-added'
  | 'blocker-cleared'
  | 'rollback-updated'
  | 'approval-requested'
  | 'reset'

/** A single, human-readable entry in the persisted DevOps Center event log. */
export interface DevOpsLogEntry {
  id: string
  type: DevOpsLogType
  message: string
  createdAt: string
}

/** The full persisted DevOps Center snapshot. */
export interface DevOpsSnapshot {
  /** Newest-first list of deployments. deployments[0] is the current candidate. */
  deployments: DeploymentItem[]
  /** Newest-first log of meaningful DevOps changes (the deployment history). */
  eventLog: DevOpsLogEntry[]
}

/** Fields a caller supplies to create a new deployment candidate. */
export interface NewDeploymentInput {
  title: string
  environment: DeploymentEnvironment
  version?: string
  releaseId?: string | null
  gitBranch?: string
  gitCommit?: string
  rollbackPlan?: string
  ownerWorkerId?: string
}
