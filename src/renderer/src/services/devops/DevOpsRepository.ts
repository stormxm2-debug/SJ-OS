import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import { qaRepository } from '@renderer/services/qa/QaRepository'
import { releaseRepository } from '@renderer/services/release/ReleaseRepository'
import { DevOpsEvents, type DevOpsEventName } from './DevOpsEvents'
import { DevOpsState } from './DevOpsState'
import { devopsSeed } from './seed'
import type {
  DeploymentItem,
  DeploymentLogEntry,
  DevOpsLogEntry,
  DevOpsLogType,
  DevOpsSnapshot,
  NewDeploymentInput
} from './types'

export interface DevOpsOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Read-only summary of the current release, for the DevOps Center. */
export interface ReleaseSummary {
  releaseId: string
  title: string
  version: string
  status: string
  qaStatus: string
  approvalStatus: string
  deploymentStatus: string
  blockers: string[]
  warnings: string[]
}

/** Read-only summary of the latest QA run, for the DevOps Center. */
export interface QaSummary {
  qaRunId: string
  title: string
  typecheckStatus: string
  buildStatus: string
  regressionStatus: string
  releaseBlockers: string[]
  warnings: string[]
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

function cloneSeed(): DevOpsSnapshot {
  return JSON.parse(JSON.stringify(devopsSeed)) as DevOpsSnapshot
}

/**
 * Repository over the DevOps Center. Same shape as ReleaseRepository /
 * QaRepository / ApprovalRepository / DevOsRepository: a state holder + event
 * bus, mutations return a result and persist through DevOpsState. All DevOps
 * logic lives here, not in React components. Meaningful changes append to the
 * persisted event log, which doubles as the deployment history.
 *
 * Actions are safe and local only — no external API, no database, and never any
 * destructive git operation. The deployment summarises the Release and QA
 * Centers, can raise a CEO approval in the Approval Center, and records status
 * changes in the Development OS — all via simple public repository calls, no
 * shared state and no redesign.
 */
export class DevOpsRepository {
  private seq = 0

  constructor(
    private readonly state = new DevOpsState(),
    private readonly events = new DevOpsEvents()
  ) {}

  getSnapshot(): DevOpsSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: DevOpsEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('devops:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: DevOpsLogType, message: string): DevOpsLogEntry {
    return { id: this.nextId('dopevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: DevOpsSnapshot, type: DevOpsLogType, message: string): DevOpsSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: DevOpsSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listDeployments(): DeploymentItem[] {
    return this.state.getSnapshot().deployments
  }

  /** The current deployment candidate, or null if there are none. */
  getCurrentDeployment(): DeploymentItem | null {
    return this.state.getSnapshot().deployments[0] ?? null
  }

  getEventLog(): DevOpsLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full DevOps Center, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  /** Summarise the current release (Release Center). Null when none exists. */
  getReleaseSummary(): ReleaseSummary | null {
    const release = releaseRepository.getCurrentRelease()
    if (!release) return null
    return {
      releaseId: release.releaseId,
      title: release.title,
      version: release.version,
      status: release.status,
      qaStatus: release.qaStatus,
      approvalStatus: release.approvalStatus,
      deploymentStatus: release.deploymentStatus,
      blockers: release.blockers,
      warnings: release.warnings
    }
  }

  /** Summarise the latest QA run (QA Center). Null when none exists. */
  getLatestQaSummary(): QaSummary | null {
    const run = qaRepository.getLatestRun()
    if (!run) return null
    return {
      qaRunId: run.qaRunId,
      title: run.title,
      typecheckStatus: run.typecheckStatus,
      buildStatus: run.buildStatus,
      regressionStatus: run.regressionStatus,
      releaseBlockers: run.releaseBlockers,
      warnings: run.warnings
    }
  }

  // --- create --------------------------------------------------------------

  /** Create a new draft deployment candidate and make it the current one. */
  createDeploymentCandidate(input: NewDeploymentInput): DevOpsOperationResult<DeploymentItem> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'deployment title is empty' }
    const now = new Date().toISOString()
    const deployment: DeploymentItem = {
      deploymentId: this.nextId('dep'),
      title,
      environment: input.environment,
      status: 'draft',
      releaseId: input.releaseId ?? null,
      version: input.version?.trim() || '',
      gitBranch: input.gitBranch?.trim() || 'main',
      gitCommit: input.gitCommit?.trim() || 'HEAD',
      buildStatus: 'pending',
      qaStatus: 'pending',
      approvalStatus: 'not-required',
      deploymentStatus: 'pending',
      artifactStatus: 'pending',
      healthStatus: 'unknown',
      rollbackPlan: input.rollbackPlan?.trim() || 'Rollback plan not defined yet.',
      deploymentLogs: [
        { id: this.nextId('deplog'), message: `Deployment candidate created for ${input.environment}.`, createdAt: now }
      ],
      blockers: [],
      warnings: [],
      checklist: [
        { label: 'Build artifact ready', done: false },
        { label: 'QA passed', done: false },
        { label: 'Environment ready', done: false },
        { label: 'CEO approval received', done: false },
        { label: 'Rollback plan drafted', done: false }
      ],
      startedAt: now,
      completedAt: null,
      ownerWorkerId: input.ownerWorkerId?.trim() || 'devops'
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, deployments: [deployment, ...snapshot.deployments] },
        'deployment-created',
        `Deployment candidate created: ${title} (${input.environment})`
      )
    )
    return { success: true, data: deployment }
  }

  // --- mutation helpers ----------------------------------------------------

  private withUpdated(
    snapshot: DevOpsSnapshot,
    id: string,
    mutate: (deployment: DeploymentItem) => DeploymentItem
  ): { deployment: DeploymentItem; deployments: DeploymentItem[] } | null {
    const index = snapshot.deployments.findIndex((d) => d.deploymentId === id)
    if (index === -1) return null
    const deployment = mutate(snapshot.deployments[index])
    const deployments = [...snapshot.deployments]
    deployments[index] = deployment
    return { deployment, deployments }
  }

  private tickChecklist(deployment: DeploymentItem, label: string): DeploymentItem {
    return {
      ...deployment,
      checklist: deployment.checklist.map((c) => (c.label === label ? { ...c, done: true } : c))
    }
  }

  private appendLog(deployment: DeploymentItem, message: string): DeploymentItem {
    const entry: DeploymentLogEntry = { id: this.nextId('deplog'), message, createdAt: new Date().toISOString() }
    return { ...deployment, deploymentLogs: [entry, ...deployment.deploymentLogs] }
  }

  private commitDeployment(
    snapshot: DevOpsSnapshot,
    result: { deployment: DeploymentItem; deployments: DeploymentItem[] },
    type: DevOpsLogType,
    message: string
  ): void {
    this.commit(this.withLog({ ...snapshot, deployments: result.deployments }, type, message))
  }

  // --- artifact / environment ----------------------------------------------

  markBuildArtifactReady(id: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.appendLog(
        this.tickChecklist({ ...d, artifactStatus: 'ready', buildStatus: 'passed' }, 'Build artifact ready'),
        'Build artifact marked ready.'
      )
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'artifact-ready', `Build artifact ready: ${result.deployment.title}`)
    return { success: true, data: result.deployment }
  }

  markEnvironmentReady(id: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.appendLog(
        this.tickChecklist({ ...d, status: d.status === 'blocked' ? d.status : 'ready' }, 'Environment ready'),
        `Environment ${d.environment} marked ready.`
      )
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'environment-ready', `Environment ready: ${result.deployment.environment}`)
    return { success: true, data: result.deployment }
  }

  // --- deployment lifecycle (DevOS integration) ----------------------------

  markDeploymentStarted(id: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const current = snapshot.deployments.find((d) => d.deploymentId === id)
    if (!current) return { success: false, error: 'deployment not found' }
    if (current.blockers.length > 0) return { success: false, error: 'resolve blockers first' }
    const now = new Date().toISOString()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.appendLog(
        { ...d, status: 'deploying', deploymentStatus: 'in-progress', startedAt: now },
        `Deployment started to ${d.environment}.`
      )
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'deployment-started', `Deployment started: ${result.deployment.title} → ${result.deployment.environment}`)
    this.notifyDevOs(`Deploying ${result.deployment.title} ${result.deployment.version} to ${result.deployment.environment}`)
    return { success: true, data: result.deployment }
  }

  markDeploymentSuccessful(id: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const now = new Date().toISOString()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.appendLog(
        { ...d, status: 'deployed', deploymentStatus: 'deployed', healthStatus: 'healthy', completedAt: now },
        `Deployment to ${d.environment} succeeded.`
      )
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'deployment-succeeded', `Deployment succeeded: ${result.deployment.title} → ${result.deployment.environment}`)
    this.notifyDevOs(
      `Deployed ${result.deployment.title} ${result.deployment.version} to ${result.deployment.environment}`,
      `Verify ${result.deployment.environment} health after deploying ${result.deployment.version}`
    )
    return { success: true, data: result.deployment }
  }

  markDeploymentFailed(id: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const now = new Date().toISOString()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.appendLog(
        { ...d, status: 'failed', deploymentStatus: 'failed', healthStatus: 'degraded', completedAt: now },
        `Deployment to ${d.environment} failed.`
      )
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'deployment-failed', `Deployment failed: ${result.deployment.title} → ${result.deployment.environment}`)
    this.notifyDevOs(
      `Deployment failed for ${result.deployment.title} ${result.deployment.version}`,
      `Investigate failed deployment of ${result.deployment.version} and consider rollback`
    )
    return { success: true, data: result.deployment }
  }

  // --- logs / blockers / rollback ------------------------------------------

  addDeploymentLog(id: string, message: string): DevOpsOperationResult<DeploymentItem> {
    const text = message.trim()
    if (!text) return { success: false, error: 'log message is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (d) => this.appendLog(d, text))
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'log-added', `Log added (${result.deployment.title}): ${text}`)
    return { success: true, data: result.deployment }
  }

  addBlocker(id: string, blocker: string): DevOpsOperationResult<DeploymentItem> {
    const text = blocker.trim()
    if (!text) return { success: false, error: 'blocker is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.appendLog({ ...d, blockers: [text, ...d.blockers], status: 'blocked' }, `Blocker added: ${text}`)
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'blocker-added', `Deployment blocker added (${result.deployment.title}): ${text}`)
    this.notifyDevOs(`Deployment blocked: ${result.deployment.title} — ${text}`)
    return { success: true, data: result.deployment }
  }

  clearBlocker(id: string, blocker: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (d) => {
      const blockers = d.blockers.filter((b) => b !== blocker)
      const status = d.status === 'blocked' && blockers.length === 0 ? 'draft' : d.status
      return this.appendLog({ ...d, blockers, status }, `Blocker cleared: ${blocker}`)
    })
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'blocker-cleared', `Deployment blocker cleared (${result.deployment.title})`)
    return { success: true, data: result.deployment }
  }

  updateRollbackPlan(id: string, plan: string): DevOpsOperationResult<DeploymentItem> {
    const text = plan.trim()
    if (!text) return { success: false, error: 'rollback plan is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (d) =>
      this.tickChecklist({ ...d, rollbackPlan: text }, 'Rollback plan drafted')
    )
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'rollback-updated', `Rollback plan updated: ${result.deployment.title}`)
    return { success: true, data: result.deployment }
  }

  // --- Approval Center integration -----------------------------------------

  /**
   * Raise a CEO approval request for this deployment in the Approval Center and
   * set the approval gate to pending. Simple createApproval call — no redesign.
   * Production deployments are treated as higher risk.
   */
  requestDeploymentApproval(id: string): DevOpsOperationResult<DeploymentItem> {
    const snapshot = this.state.getSnapshot()
    const current = snapshot.deployments.find((d) => d.deploymentId === id)
    if (!current) return { success: false, error: 'deployment not found' }

    approvalRepository.createApproval({
      title: `Deployment approval: ${current.title} ${current.version}`,
      description: `Approve deployment of ${current.title} ${current.version} to ${current.environment} (branch ${current.gitBranch} @ ${current.gitCommit}).`,
      category: current.environment === 'production' ? 'destructive-operation' : 'release',
      requestedByWorkerId: current.ownerWorkerId,
      requestedByRole: 'DevOps Engineer',
      source: 'DevOps Center',
      priority: current.environment === 'production' ? 'P0' : 'P1',
      riskLevel: current.environment === 'production' ? 'critical' : 'medium',
      impactSummary: `Gates the ${current.environment} deployment of ${current.title} ${current.version}.`,
      relatedEpic: 'AI company operating system',
      relatedFeature: current.title,
      relatedTask: null
    })

    const result = this.withUpdated(snapshot, id, (d) => ({ ...d, approvalStatus: 'pending' }))
    if (!result) return { success: false, error: 'deployment not found' }
    this.commitDeployment(snapshot, result, 'approval-requested', `Deployment approval requested: ${result.deployment.title}`)
    return { success: true, data: result.deployment }
  }

  /**
   * Record a DevOps status change in the Development OS event log, and — when a
   * next step is given — update the DevOS nextAction (which also logs). Keeps
   * DevOS the owner of its own state; we only call its public API.
   */
  private notifyDevOs(note: string, nextAction?: string): void {
    if (nextAction) {
      devOsRepository.setNextAction(nextAction)
    } else {
      devOsRepository.recordEvent(note)
    }
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the DevOps Center back to the seed. */
  resetDemoState(): DevOpsOperationResult<DevOpsSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'DevOps Center reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const devOpsRepository = new DevOpsRepository()
