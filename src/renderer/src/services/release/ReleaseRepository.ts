import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import { qaRepository } from '@renderer/services/qa/QaRepository'
import { ReleaseEvents, type ReleaseEventName } from './ReleaseEvents'
import { ReleaseState } from './ReleaseState'
import { releaseSeed } from './seed'
import type {
  NewReleaseInput,
  ReleaseGateStatus,
  ReleaseItem,
  ReleaseLogEntry,
  ReleaseLogType,
  ReleaseSnapshot
} from './types'

export interface ReleaseOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** A read-only summary of the latest QA run, for the Release Center. */
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

function cloneSeed(): ReleaseSnapshot {
  return JSON.parse(JSON.stringify(releaseSeed)) as ReleaseSnapshot
}

/** Map a QA run status onto the release build/QA gate status. */
function gateFromQa(status: string): ReleaseGateStatus {
  if (status === 'passed') return 'passed'
  if (status === 'failed' || status === 'blocked') return 'failed'
  if (status === 'warning') return 'warning'
  return 'pending'
}

/**
 * Repository over the Release Center. Same shape as QaRepository /
 * ApprovalRepository / CtoRepository / DevOsRepository: a state holder + event
 * bus, mutations return a result and persist through ReleaseState. All release
 * logic lives here, not in React components. Meaningful changes append to the
 * persisted event log, which doubles as the release history.
 *
 * Actions are safe and local only — no external API, no database. The release
 * pulls its QA summary from the QA Center, raises approval requests in the
 * Approval Center, and records status changes in the Development OS — all via
 * simple public repository calls, no shared state and no redesign.
 */
export class ReleaseRepository {
  private seq = 0

  constructor(
    private readonly state = new ReleaseState(),
    private readonly events = new ReleaseEvents()
  ) {}

  getSnapshot(): ReleaseSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: ReleaseEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('release:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: ReleaseLogType, message: string): ReleaseLogEntry {
    return { id: this.nextId('relevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: ReleaseSnapshot, type: ReleaseLogType, message: string): ReleaseSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: ReleaseSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listReleases(): ReleaseItem[] {
    return this.state.getSnapshot().releases
  }

  /** The current release candidate, or null if there are none. */
  getCurrentRelease(): ReleaseItem | null {
    return this.state.getSnapshot().releases[0] ?? null
  }

  getEventLog(): ReleaseLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full Release Center, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  /**
   * Summarise the latest QA run for the Release Center. Read-only cross-service
   * call — returns null when there is no QA run to summarise.
   */
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

  /** Create a new draft release candidate and make it the current one. */
  createReleaseCandidate(input: NewReleaseInput): ReleaseOperationResult<ReleaseItem> {
    const title = input.title.trim()
    const version = input.version.trim()
    if (!title) return { success: false, error: 'release title is empty' }
    if (!version) return { success: false, error: 'release version is empty' }
    const now = new Date().toISOString()
    const release: ReleaseItem = {
      releaseId: this.nextId('rel'),
      title,
      version,
      status: 'draft',
      releaseType: input.releaseType,
      relatedSprint: input.relatedSprint?.trim() || '',
      relatedEpic: input.relatedEpic?.trim() || '',
      relatedFeatures: input.relatedFeatures ?? [],
      qaRunId: null,
      approvalId: null,
      buildStatus: 'pending',
      qaStatus: 'pending',
      approvalStatus: 'not-required',
      deploymentStatus: 'pending',
      releaseNotes: (input.releaseNotes ?? '').trim(),
      blockers: [],
      warnings: [],
      checklist: [
        { label: 'Typecheck passing', done: false },
        { label: 'Production build passing', done: false },
        { label: 'QA reviewed', done: false },
        { label: 'Release notes written', done: false },
        { label: 'CEO approval received', done: false }
      ],
      createdAt: now,
      updatedAt: now,
      releasedAt: null,
      ownerWorkerId: input.ownerWorkerId?.trim() || 'devops'
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, releases: [release, ...snapshot.releases] },
        'release-created',
        `Release candidate created: ${title} ${version}`
      )
    )
    return { success: true, data: release }
  }

  // --- mutation helper -----------------------------------------------------

  private withUpdated(
    snapshot: ReleaseSnapshot,
    id: string,
    mutate: (release: ReleaseItem) => ReleaseItem
  ): { release: ReleaseItem; releases: ReleaseItem[] } | null {
    const index = snapshot.releases.findIndex((r) => r.releaseId === id)
    if (index === -1) return null
    const release: ReleaseItem = { ...mutate(snapshot.releases[index]), updatedAt: new Date().toISOString() }
    const releases = [...snapshot.releases]
    releases[index] = release
    return { release, releases }
  }

  /** Tick a named checklist item to done if present. */
  private tickChecklist(release: ReleaseItem, label: string): ReleaseItem {
    return {
      ...release,
      checklist: release.checklist.map((c) => (c.label === label ? { ...c, done: true } : c))
    }
  }

  private commitRelease(
    snapshot: ReleaseSnapshot,
    result: { release: ReleaseItem; releases: ReleaseItem[] },
    type: ReleaseLogType,
    message: string
  ): void {
    this.commit(this.withLog({ ...snapshot, releases: result.releases }, type, message))
  }

  // --- QA review (QA Center integration) -----------------------------------

  /**
   * Pull the latest QA run into this release: link its id and copy build/QA
   * status and warnings across, then move the release into approval-required.
   * Simple read from the QA repository — no shared state.
   */
  markQaReviewed(id: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const qa = this.getLatestQaSummary()
    const result = this.withUpdated(snapshot, id, (r) => {
      const qaStatus = qa ? gateFromQa(qa.regressionStatus === 'warning' ? 'warning' : 'passed') : r.qaStatus
      const buildStatus = qa ? gateFromQa(qa.buildStatus) : r.buildStatus
      const merged = this.tickChecklist(
        {
          ...r,
          qaRunId: qa?.qaRunId ?? r.qaRunId,
          qaStatus,
          buildStatus,
          warnings: qa ? Array.from(new Set([...r.warnings, ...qa.warnings])) : r.warnings,
          status: r.status === 'draft' || r.status === 'qa-review' ? 'approval-required' : r.status
        },
        'QA reviewed'
      )
      return merged
    })
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(snapshot, result, 'qa-reviewed', `QA reviewed for ${result.release.title} ${result.release.version}`)
    return { success: true, data: result.release }
  }

  // --- approval (Approval Center integration) ------------------------------

  /**
   * Raise a CEO approval request for this release in the Approval Center and
   * link it back. Sets the approval gate to pending and the status to
   * approval-required. Simple createApproval call — no redesign.
   */
  requestApproval(id: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const current = snapshot.releases.find((r) => r.releaseId === id)
    if (!current) return { success: false, error: 'release not found' }

    const approval = approvalRepository.createApproval({
      title: `Release approval: ${current.title} ${current.version}`,
      description: `Approve release candidate ${current.title} ${current.version} (${current.releaseType}) for release.`,
      category: 'release',
      requestedByWorkerId: current.ownerWorkerId,
      requestedByRole: 'DevOps Engineer',
      source: 'Release Center',
      priority: 'P1',
      riskLevel: current.releaseType === 'production' ? 'high' : 'medium',
      impactSummary: `Gates the ${current.releaseType} release of ${current.title} ${current.version}.`,
      relatedEpic: current.relatedEpic || null,
      relatedFeature: current.relatedFeatures[0] ?? null,
      relatedTask: null
    })

    const result = this.withUpdated(snapshot, id, (r) => ({
      ...r,
      approvalId: approval.data?.approvalId ?? r.approvalId,
      approvalStatus: 'pending',
      status: 'approval-required'
    }))
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(
      snapshot,
      result,
      'approval-requested',
      `Approval requested for ${result.release.title} ${result.release.version}`
    )
    return { success: true, data: result.release }
  }

  /**
   * Record that CEO approval was received. Ticks the checklist and, if QA has
   * passed, advances the release to ready. Notifies the Development OS.
   */
  markApprovalReceived(id: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (r) => {
      const ticked = this.tickChecklist({ ...r, approvalStatus: 'approved' }, 'CEO approval received')
      const status = ticked.qaStatus === 'passed' && ticked.blockers.length === 0 ? 'ready' : ticked.status
      return { ...ticked, status }
    })
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(
      snapshot,
      result,
      'approval-received',
      `Approval received for ${result.release.title} ${result.release.version}`
    )
    this.notifyDevOs(result.release, `Approval received for ${result.release.title} ${result.release.version}`)
    return { success: true, data: result.release }
  }

  // --- blockers ------------------------------------------------------------

  addBlocker(id: string, blocker: string): ReleaseOperationResult<ReleaseItem> {
    const text = blocker.trim()
    if (!text) return { success: false, error: 'blocker is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (r) => ({
      ...r,
      blockers: [text, ...r.blockers],
      status: 'blocked'
    }))
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(snapshot, result, 'blocker-added', `Release blocker added (${result.release.title}): ${text}`)
    this.notifyDevOs(result.release, `Release blocked: ${result.release.title} ${result.release.version} — ${text}`)
    return { success: true, data: result.release }
  }

  clearBlocker(id: string, blocker: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (r) => {
      const blockers = r.blockers.filter((b) => b !== blocker)
      const status = r.status === 'blocked' && blockers.length === 0 ? 'approval-required' : r.status
      return { ...r, blockers, status }
    })
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(snapshot, result, 'blocker-cleared', `Release blocker cleared (${result.release.title})`)
    return { success: true, data: result.release }
  }

  // --- terminal transitions (DevOS integration) ----------------------------

  markReadyForRelease(id: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const current = snapshot.releases.find((r) => r.releaseId === id)
    if (!current) return { success: false, error: 'release not found' }
    if (current.blockers.length > 0) return { success: false, error: 'resolve blockers first' }
    const result = this.withUpdated(snapshot, id, (r) => ({ ...r, status: 'ready' }))
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(snapshot, result, 'marked-ready', `Marked ready for release: ${result.release.title} ${result.release.version}`)
    this.notifyDevOs(
      result.release,
      `Ready for release: ${result.release.title} ${result.release.version}`,
      `Ship release: ${result.release.title} ${result.release.version}`
    )
    return { success: true, data: result.release }
  }

  markReleased(id: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const now = new Date().toISOString()
    const result = this.withUpdated(snapshot, id, (r) => ({
      ...r,
      status: 'released',
      deploymentStatus: 'deployed',
      releasedAt: now
    }))
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(snapshot, result, 'released', `Released: ${result.release.title} ${result.release.version}`)
    this.notifyDevOs(
      result.release,
      `Released: ${result.release.title} ${result.release.version}`,
      `Plan the next release after ${result.release.version}`
    )
    return { success: true, data: result.release }
  }

  cancelRelease(id: string): ReleaseOperationResult<ReleaseItem> {
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (r) => ({ ...r, status: 'cancelled' }))
    if (!result) return { success: false, error: 'release not found' }
    this.commitRelease(snapshot, result, 'cancelled', `Release cancelled: ${result.release.title} ${result.release.version}`)
    this.notifyDevOs(result.release, `Release cancelled: ${result.release.title} ${result.release.version}`)
    return { success: true, data: result.release }
  }

  /**
   * Record a release status change in the Development OS event log, and — when a
   * next step is given — update the DevOS nextAction (which also logs). Keeps
   * DevOS the owner of its own state; we only call its public API.
   */
  private notifyDevOs(release: ReleaseItem, note: string, nextAction?: string): void {
    if (nextAction) {
      devOsRepository.setNextAction(nextAction)
    } else {
      devOsRepository.recordEvent(note)
    }
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Release Center back to the seed. */
  resetDemoState(): ReleaseOperationResult<ReleaseSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Release Center reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const releaseRepository = new ReleaseRepository()
