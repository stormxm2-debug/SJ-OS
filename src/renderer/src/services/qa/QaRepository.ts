import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import { QaEvents, type QaEventName } from './QaEvents'
import { QaState } from './QaState'
import { qaSeed } from './seed'
import type { NewQaRunInput, QaLogEntry, QaLogType, QaRun, QaSnapshot } from './types'

export interface QaOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

function cloneSeed(): QaSnapshot {
  return JSON.parse(JSON.stringify(qaSeed)) as QaSnapshot
}

/**
 * Repository over the QA Center. Same shape as ApprovalRepository /
 * CtoRepository / PmRepository / DevOsRepository: a state holder + event bus,
 * mutations return a result and persist through QaState. All QA logic lives
 * here, not in React components. Meaningful changes append to the persisted
 * event log, which doubles as the QA history.
 *
 * Actions are safe and local only — no external API, no database. A run's
 * pass/fail drives the Development OS event log (and nextAction) through
 * DevOsRepository's public API, and its release blockers can be escalated into
 * an Approval Center request via simple repository calls.
 */
export class QaRepository {
  private seq = 0

  constructor(
    private readonly state = new QaState(),
    private readonly events = new QaEvents()
  ) {}

  getSnapshot(): QaSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: QaEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('qa:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: QaLogType, message: string): QaLogEntry {
    return { id: this.nextId('qaevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: QaSnapshot, type: QaLogType, message: string): QaSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: QaSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listRuns(): QaRun[] {
    return this.state.getSnapshot().runs
  }

  /** The latest QA run, or null if there are none. */
  getLatestRun(): QaRun | null {
    return this.state.getSnapshot().runs[0] ?? null
  }

  getEventLog(): QaLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full QA Center, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- create --------------------------------------------------------------

  /** Create a new QA run in the 'running' state and make it the latest run. */
  createQaRun(input: NewQaRunInput): QaOperationResult<QaRun> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'run title is empty' }
    const now = new Date().toISOString()
    const runItem: QaRun = {
      qaRunId: this.nextId('qa'),
      title,
      scope: input.scope,
      status: 'running',
      typecheckStatus: 'pending',
      buildStatus: 'pending',
      regressionStatus: 'pending',
      securityStatus: 'pending',
      performanceStatus: 'pending',
      coverageStatus: 'pending',
      releaseBlockers: [],
      warnings: [],
      passedChecks: [],
      failedChecks: [],
      startedAt: now,
      completedAt: null,
      ownerWorkerId: input.ownerWorkerId?.trim() || 'qa',
      relatedEpic: input.relatedEpic ?? null,
      relatedFeature: input.relatedFeature ?? null,
      relatedTask: input.relatedTask ?? null
    }
    const snapshot = this.state.getSnapshot()
    this.commit(this.withLog({ ...snapshot, runs: [runItem, ...snapshot.runs] }, 'run-created', `QA run created: ${title}`))
    return { success: true, data: runItem }
  }

  // --- run mutations -------------------------------------------------------

  /** Apply a mutation to one run without committing. */
  private withUpdatedRun(
    snapshot: QaSnapshot,
    runId: string,
    mutate: (run: QaRun) => QaRun
  ): { run: QaRun; runs: QaRun[] } | null {
    const index = snapshot.runs.findIndex((r) => r.qaRunId === runId)
    if (index === -1) return null
    const runItem = mutate(snapshot.runs[index])
    const runs = [...snapshot.runs]
    runs[index] = runItem
    return { run: runItem, runs }
  }

  markCheckPassed(runId: string, check: string): QaOperationResult<QaRun> {
    const text = check.trim()
    if (!text) return { success: false, error: 'check name is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedRun(snapshot, runId, (r) => ({
      ...r,
      passedChecks: [text, ...r.passedChecks],
      failedChecks: r.failedChecks.filter((c) => c !== text)
    }))
    if (!result) return { success: false, error: 'run not found' }
    this.commit(this.withLog({ ...snapshot, runs: result.runs }, 'check-passed', `Check passed (${result.run.title}): ${text}`))
    return { success: true, data: result.run }
  }

  markCheckFailed(runId: string, check: string): QaOperationResult<QaRun> {
    const text = check.trim()
    if (!text) return { success: false, error: 'check name is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedRun(snapshot, runId, (r) => ({
      ...r,
      failedChecks: [text, ...r.failedChecks],
      passedChecks: r.passedChecks.filter((c) => c !== text)
    }))
    if (!result) return { success: false, error: 'run not found' }
    this.commit(this.withLog({ ...snapshot, runs: result.runs }, 'check-failed', `Check failed (${result.run.title}): ${text}`))
    return { success: true, data: result.run }
  }

  addWarning(runId: string, warning: string): QaOperationResult<QaRun> {
    const text = warning.trim()
    if (!text) return { success: false, error: 'warning is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedRun(snapshot, runId, (r) => ({ ...r, warnings: [text, ...r.warnings] }))
    if (!result) return { success: false, error: 'run not found' }
    this.commit(this.withLog({ ...snapshot, runs: result.runs }, 'warning-added', `Warning added (${result.run.title}): ${text}`))
    return { success: true, data: result.run }
  }

  clearWarning(runId: string, warning: string): QaOperationResult<QaRun> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedRun(snapshot, runId, (r) => ({
      ...r,
      warnings: r.warnings.filter((w) => w !== warning)
    }))
    if (!result) return { success: false, error: 'run not found' }
    this.commit(this.withLog({ ...snapshot, runs: result.runs }, 'warning-cleared', `Warning cleared (${result.run.title})`))
    return { success: true, data: result.run }
  }

  addReleaseBlocker(runId: string, blocker: string): QaOperationResult<QaRun> {
    const text = blocker.trim()
    if (!text) return { success: false, error: 'blocker is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedRun(snapshot, runId, (r) => ({
      ...r,
      releaseBlockers: [text, ...r.releaseBlockers],
      status: 'blocked'
    }))
    if (!result) return { success: false, error: 'run not found' }
    this.commit(this.withLog({ ...snapshot, runs: result.runs }, 'blocker-added', `Release blocker added (${result.run.title}): ${text}`))
    return { success: true, data: result.run }
  }

  clearReleaseBlocker(runId: string, blocker: string): QaOperationResult<QaRun> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdatedRun(snapshot, runId, (r) => {
      const releaseBlockers = r.releaseBlockers.filter((b) => b !== blocker)
      // Leaving 'blocked' only makes sense while blockers remain.
      const status = r.status === 'blocked' && releaseBlockers.length === 0 ? 'running' : r.status
      return { ...r, releaseBlockers, status }
    })
    if (!result) return { success: false, error: 'run not found' }
    this.commit(this.withLog({ ...snapshot, runs: result.runs }, 'blocker-cleared', `Release blocker cleared (${result.run.title})`))
    return { success: true, data: result.run }
  }

  // --- terminal status (DevOS integration) ---------------------------------

  /**
   * Mark a run passed or failed, stamp completedAt, then notify the Development
   * OS: both outcomes append a DevOS event-log entry, and because a QA outcome
   * blocks or clears release readiness it also updates the DevOS nextAction via
   * DevOsRepository.setNextAction (which logs the change).
   */
  private finishRun(runId: string, status: 'passed' | 'failed'): QaOperationResult<QaRun> {
    const snapshot = this.state.getSnapshot()
    const now = new Date().toISOString()
    const result = this.withUpdatedRun(snapshot, runId, (r) => ({ ...r, status, completedAt: now }))
    if (!result) return { success: false, error: 'run not found' }
    this.commit(
      this.withLog(
        { ...snapshot, runs: result.runs },
        status === 'passed' ? 'run-passed' : 'run-failed',
        `QA run ${status}: ${result.run.title}`
      )
    )

    // Development OS integration — a QA outcome affects release readiness.
    if (status === 'passed') {
      devOsRepository.setNextAction(`QA passed for "${result.run.title}" — clear for release readiness`)
    } else {
      devOsRepository.setNextAction(`QA failed for "${result.run.title}" — resolve before release`)
    }
    return { success: true, data: result.run }
  }

  markRunPassed(runId: string): QaOperationResult<QaRun> {
    return this.finishRun(runId, 'passed')
  }

  markRunFailed(runId: string): QaOperationResult<QaRun> {
    return this.finishRun(runId, 'failed')
  }

  // --- Approval Center integration -----------------------------------------

  /**
   * Escalate a run's release blockers to the Approval Center as a single CEO
   * review request. Simple cross-service call — no shared state, no redesign.
   * No-op (success, created:false) when the run has no blockers.
   */
  escalateBlockersToApproval(runId: string): QaOperationResult<{ created: boolean }> {
    const runItem = this.state.getSnapshot().runs.find((r) => r.qaRunId === runId)
    if (!runItem) return { success: false, error: 'run not found' }
    if (runItem.releaseBlockers.length === 0) {
      return { success: true, data: { created: false } }
    }
    approvalRepository.createApproval({
      title: `Release review: ${runItem.title}`,
      description: `QA run "${runItem.title}" has ${runItem.releaseBlockers.length} release blocker(s):\n- ${runItem.releaseBlockers.join('\n- ')}`,
      category: 'release',
      requestedByWorkerId: runItem.ownerWorkerId,
      requestedByRole: 'QA Engineer',
      source: 'QA Center',
      priority: 'P1',
      riskLevel: runItem.releaseBlockers.length > 1 ? 'high' : 'medium',
      impactSummary: 'QA has flagged release blockers; CEO review required before release.',
      relatedEpic: runItem.relatedEpic,
      relatedFeature: runItem.relatedFeature,
      relatedTask: runItem.relatedTask
    })
    const snapshot = this.state.getSnapshot()
    this.commit(this.withLog(snapshot, 'escalated', `Escalated release blockers to Approval Center: ${runItem.title}`))
    return { success: true, data: { created: true } }
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the QA Center back to the seed. */
  resetDemoState(): QaOperationResult<QaSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'QA Center reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const qaRepository = new QaRepository()
