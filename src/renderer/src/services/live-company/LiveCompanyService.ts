import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { pmRepository } from '@renderer/services/pm/PmRepository'
import { ctoRepository } from '@renderer/services/cto/CtoRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import { qaRepository } from '@renderer/services/qa/QaRepository'
import { releaseRepository } from '@renderer/services/release/ReleaseRepository'
import { devOpsRepository } from '@renderer/services/devops/DevOpsRepository'
import type { CompanyActivityEntry, CompanySnapshot, DepartmentStage } from './types'

/** Sources whose event logs are merged into the unified activity feed. */
interface SourceLog {
  source: string
  entries: Array<{ id: string; message: string; createdAt: string }>
}

const MAX_ACTIVITY = 40

/**
 * Read-only aggregation over every AI-company module. Subscribes to the DevOS,
 * PM Planner, CTO Room, Approval Center, QA Center, Release Center and DevOps
 * Center repositories, and recomputes a single unified CompanySnapshot whenever
 * any of them changes. Mirrors the pub/sub shape of the other services so a
 * React hook can bind to it with useSyncExternalStore.
 *
 * This service owns no persisted state — it is a live projection. Its "quick
 * actions" are thin, safe calls into the underlying repositories (no redesign,
 * no external API, no database).
 */
export class LiveCompanyService {
  private cache: CompanySnapshot
  private listeners = new Set<() => void>()

  constructor() {
    this.cache = this.build()
    // Recompute on any change from an underlying module.
    const repos = [
      devOsRepository,
      pmRepository,
      ctoRepository,
      approvalRepository,
      qaRepository,
      releaseRepository,
      devOpsRepository
    ]
    for (const repo of repos) {
      repo.subscribe(() => this.recompute())
    }
  }

  getSnapshot(): CompanySnapshot {
    return this.cache
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Force a recompute + notify (used by the "Refresh" quick action). */
  refresh(): void {
    this.recompute()
  }

  private recompute(): void {
    this.cache = this.build()
    this.listeners.forEach((listener) => listener())
  }

  /** Pretty-printed JSON of the current unified snapshot, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.cache, null, 2)
  }

  /** Push the current next recommended action into the Development OS session. */
  promoteNextRecommendedAction(): void {
    devOsRepository.setNextAction(this.cache.nextRecommendedAction)
  }

  /**
   * Reset every underlying module back to its seed. Live Company has no state of
   * its own, so resetting the company means resetting the modules it summarises.
   * Each reset emits an event, which recomputes this snapshot.
   */
  resetDemoState(): void {
    devOsRepository.resetDemoState()
    pmRepository.resetPlan()
    ctoRepository.resetDemoState()
    approvalRepository.resetDemoState()
    qaRepository.resetDemoState()
    releaseRepository.resetDemoState()
    devOpsRepository.resetDemoState()
  }

  // --- snapshot construction -----------------------------------------------

  private build(): CompanySnapshot {
    const devos = devOsRepository.getSnapshot()
    const pm = pmRepository.getSnapshot()
    const cto = ctoRepository.getSnapshot()
    const approvals = approvalRepository.getSnapshot()
    const qa = qaRepository.getSnapshot()
    const release = releaseRepository.getSnapshot()
    const devops = devOpsRepository.getSnapshot()

    const session = devos.session
    const workers = devos.workers
    const nameOf = (id: string): string => workers.find((w) => w.workerId === id)?.name ?? id

    // PM Planner metrics
    const pmDone = pm.tasks.filter((t) => t.status === 'completed').length
    const pmBlocked = pm.tasks.filter((t) => t.status === 'blocked').length
    const pmActiveEpics = pm.epics.filter((e) => e.status === 'in_progress').length
    const pmProgress = pm.tasks.length ? Math.round((pmDone / pm.tasks.length) * 100) : 0

    // CTO Room metrics
    const ctoOpenRisks = cto.riskItems.filter((r) => r.status === 'open').length
    const ctoBlockedDecisions = cto.blockedDecisions.filter((d) => d.status === 'blocked').length
    const ctoDebt = cto.technicalDebtItems.filter((d) => d.status === 'open').length
    const ctoScore = cto.architectureHealth.score

    // Approval Center metrics
    const pendingApprovals = approvals.approvals.filter((a) => a.status === 'pending').length
    const approvalsDecided = approvals.approvals.filter((a) => a.status !== 'pending').length
    const approvalProgress = approvals.approvals.length
      ? Math.round((approvalsDecided / approvals.approvals.length) * 100)
      : 100

    // QA Center metrics
    const latestQa = qa.runs[0] ?? null
    const qaWarnings = latestQa ? latestQa.warnings.length : 0
    const qaBlockers = latestQa ? latestQa.releaseBlockers.length : 0
    const qaChecks = latestQa ? latestQa.passedChecks.length + latestQa.failedChecks.length : 0
    const qaProgress = qaChecks
      ? Math.round(((latestQa?.passedChecks.length ?? 0) / qaChecks) * 100)
      : latestQa?.status === 'passed'
        ? 100
        : 0

    // Release Center metrics
    const currentRelease = release.releases[0] ?? null
    const releaseStatus = currentRelease?.status ?? 'none'
    const releaseBlockers = currentRelease?.blockers.length ?? 0
    const releaseChecklistTotal = currentRelease?.checklist.length ?? 0
    const releaseProgress = releaseChecklistTotal
      ? Math.round(((currentRelease?.checklist.filter((c) => c.done).length ?? 0) / releaseChecklistTotal) * 100)
      : 0

    // DevOps Center metrics
    const currentDeployment = devops.deployments[0] ?? null
    const deploymentStatus = currentDeployment?.status ?? 'none'
    const deploymentBlockers = currentDeployment?.blockers.length ?? 0
    const depChecklistTotal = currentDeployment?.checklist.length ?? 0
    const deploymentProgress = depChecklistTotal
      ? Math.round(((currentDeployment?.checklist.filter((c) => c.done).length ?? 0) / depChecklistTotal) * 100)
      : 0

    // Department delivery timeline
    const departments: DepartmentStage[] = [
      {
        key: 'pm',
        label: 'PM Planner',
        status: pmActiveEpics > 0 ? 'in progress' : 'planned',
        progress: pmProgress,
        owner: nameOf('pm'),
        latestEvent: pm.eventLog[0]?.message ?? '—',
        blockerCount: pmBlocked
      },
      {
        key: 'devos',
        label: 'Development OS',
        status: session.status,
        progress: session.progress,
        owner: nameOf('architect'),
        latestEvent: devos.eventLog[0]?.message ?? '—',
        blockerCount: session.status === 'blocked' ? 1 : 0
      },
      {
        key: 'cto',
        label: 'CTO Room',
        status: ctoOpenRisks + ctoBlockedDecisions > 0 ? 'attention' : 'healthy',
        progress: ctoScore,
        owner: nameOf('cto'),
        latestEvent: cto.eventLog[0]?.message ?? '—',
        blockerCount: ctoBlockedDecisions
      },
      {
        key: 'approvals',
        label: 'Approval Center',
        status: pendingApprovals > 0 ? 'pending' : 'clear',
        progress: approvalProgress,
        owner: 'CEO',
        latestEvent: approvals.eventLog[0]?.message ?? '—',
        blockerCount: pendingApprovals
      },
      {
        key: 'qa',
        label: 'QA Center',
        status: latestQa?.status ?? 'none',
        progress: qaProgress,
        owner: nameOf('qa'),
        latestEvent: qa.eventLog[0]?.message ?? '—',
        blockerCount: qaBlockers
      },
      {
        key: 'release',
        label: 'Release Center',
        status: releaseStatus,
        progress: releaseProgress,
        owner: nameOf('devops'),
        latestEvent: release.eventLog[0]?.message ?? '—',
        blockerCount: releaseBlockers
      },
      {
        key: 'devops',
        label: 'DevOps Center',
        status: deploymentStatus,
        progress: deploymentProgress,
        owner: nameOf('devops'),
        latestEvent: devops.eventLog[0]?.message ?? '—',
        blockerCount: deploymentBlockers
      }
    ]

    const overallProgress = Math.round(
      departments.reduce((sum, d) => sum + d.progress, 0) / departments.length
    )

    // Bottlenecks across the whole company
    const bottlenecks: string[] = []
    if (session.status === 'blocked' && session.blockedReason) {
      bottlenecks.push(`DevOS blocked: ${session.blockedReason}`)
    }
    if (pmBlocked > 0) bottlenecks.push(`${pmBlocked} blocked PM task(s)`)
    if (ctoBlockedDecisions > 0) bottlenecks.push(`${ctoBlockedDecisions} blocked CTO decision(s)`)
    if (pendingApprovals > 0) bottlenecks.push(`${pendingApprovals} pending approval(s)`)
    if (qaBlockers > 0) bottlenecks.push(`${qaBlockers} QA release blocker(s)`)
    if (releaseBlockers > 0) bottlenecks.push(`${releaseBlockers} release blocker(s)`)
    if (deploymentBlockers > 0) bottlenecks.push(`${deploymentBlockers} deployment blocker(s)`)

    // Active worker (busiest, highest confidence) and department
    const workingWorkers = workers
      .filter((w) => w.currentWork.trim().length > 0)
      .sort((a, b) => b.confidence - a.confidence)
    const activeWorkerMem = workingWorkers[0] ?? workers[0] ?? null
    const activeWorker = activeWorkerMem?.name ?? '—'
    const activeDepartment = activeWorkerMem?.department ?? '—'

    // Company status
    let companyStatus = 'Working'
    if (session.status === 'blocked' || bottlenecks.length > 2) companyStatus = 'Needs attention'
    else if (deploymentStatus === 'deploying') companyStatus = 'Deploying'
    else if (releaseStatus === 'released') companyStatus = 'Released'
    else if (pendingApprovals > 0) companyStatus = 'Awaiting approval'
    else if (session.status === 'completed') companyStatus = 'Idle'

    // Next recommended action
    let nextRecommendedAction: string
    if (pendingApprovals > 0) {
      nextRecommendedAction = `Review ${pendingApprovals} pending approval(s) in the Approval Center`
    } else if (releaseBlockers > 0 && currentRelease) {
      nextRecommendedAction = `Clear ${releaseBlockers} release blocker(s) for ${currentRelease.version}`
    } else if (qaBlockers > 0) {
      nextRecommendedAction = `Resolve ${qaBlockers} QA release blocker(s)`
    } else if (session.status === 'blocked' && session.blockedReason) {
      nextRecommendedAction = `Unblock DevOS: ${session.blockedReason}`
    } else {
      nextRecommendedAction = session.nextAction || 'Continue current sprint work'
    }

    const activity = this.buildActivity([
      { source: 'DevOS', entries: devos.eventLog },
      { source: 'PM Planner', entries: pm.eventLog },
      { source: 'CTO Room', entries: cto.eventLog },
      { source: 'Approval Center', entries: approvals.eventLog },
      { source: 'QA Center', entries: qa.eventLog },
      { source: 'Release Center', entries: release.eventLog },
      { source: 'DevOps Center', entries: devops.eventLog }
    ])

    return {
      companyStatus,
      currentSprint: session.currentSprint,
      currentEpic: session.currentEpic,
      currentFeature: session.currentFeature,
      currentTask: session.currentTask,
      overallProgress,
      activeDepartment,
      activeWorker,
      bottlenecks,
      pendingApprovals,
      qaWarnings,
      releaseStatus,
      deploymentStatus,
      nextRecommendedAction,
      lastUpdated: new Date().toISOString(),
      departments,
      workers,
      activity,
      metrics: {
        overallProgress,
        architectureHealth: ctoScore,
        openTechnicalDebt: ctoDebt,
        pendingApprovals,
        qaWarnings,
        releaseBlockers,
        deploymentBlockers
      }
    }
  }

  /** Merge module event logs into one newest-first, source-tagged feed. */
  private buildActivity(logs: SourceLog[]): CompanyActivityEntry[] {
    const merged: CompanyActivityEntry[] = []
    for (const log of logs) {
      for (const entry of log.entries) {
        merged.push({
          id: `${log.source}:${entry.id}`,
          source: log.source,
          message: entry.message,
          createdAt: entry.createdAt
        })
      }
    }
    // ISO timestamps sort lexicographically in chronological order.
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return merged.slice(0, MAX_ACTIVITY)
  }
}

export const liveCompanyService = new LiveCompanyService()
