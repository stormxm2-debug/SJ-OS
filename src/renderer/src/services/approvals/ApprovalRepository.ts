import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { ctoRepository } from '@renderer/services/cto/CtoRepository'
import { ApprovalEvents, type ApprovalEventName } from './ApprovalEvents'
import { ApprovalState } from './ApprovalState'
import { approvalSeed } from './seed'
import type {
  ApprovalCategory,
  ApprovalDecision,
  ApprovalItem,
  ApprovalLogEntry,
  ApprovalLogType,
  ApprovalSnapshot,
  NewApprovalInput
} from './types'

export interface ApprovalOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

function cloneSeed(): ApprovalSnapshot {
  return JSON.parse(JSON.stringify(approvalSeed)) as ApprovalSnapshot
}

/** Map a CTO blocked decision to a sensible approval category by keyword. */
function categoryForDecision(text: string): ApprovalCategory {
  const lower = text.toLowerCase()
  if (/(medical|privacy|consent|pii|data)/.test(lower)) return 'customer-data'
  if (/(api|external|provider|integration)/.test(lower)) return 'external-api'
  if (/(release|ship|launch)/.test(lower)) return 'release'
  if (/(spend|budget|cost|finance)/.test(lower)) return 'finance'
  if (/(insurance)/.test(lower)) return 'insurance-analysis'
  return 'architecture'
}

/**
 * Repository over the Approval Center. Same shape as CtoRepository /
 * PmRepository / DevOsRepository: a state holder + event bus, mutations return a
 * result and persist through ApprovalState. All approval logic lives here, not
 * in React components. Meaningful changes append to the persisted event log,
 * which doubles as the decision history.
 *
 * Actions are safe and local only — no external API, no database. Deciding an
 * item drives the Development OS event log (and optionally its nextAction)
 * through DevOsRepository's public API. CTO Room blocked decisions can be
 * imported as approval requests via simple repository calls.
 */
export class ApprovalRepository {
  private seq = 0

  constructor(
    private readonly state = new ApprovalState(),
    private readonly events = new ApprovalEvents()
  ) {}

  getSnapshot(): ApprovalSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: ApprovalEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('approvals:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: ApprovalLogType, message: string): ApprovalLogEntry {
    return { id: this.nextId('aprevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: ApprovalSnapshot, type: ApprovalLogType, message: string): ApprovalSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: ApprovalSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listApprovals(): ApprovalItem[] {
    return this.state.getSnapshot().approvals
  }

  getEventLog(): ApprovalLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full Approval Center, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- create --------------------------------------------------------------

  /** Create a new pending approval request. */
  createApproval(input: NewApprovalInput): ApprovalOperationResult<ApprovalItem> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'approval title is empty' }
    const now = new Date().toISOString()
    const approval: ApprovalItem = {
      approvalId: this.nextId('apr'),
      title,
      description: (input.description ?? '').trim(),
      category: input.category,
      requestedByWorkerId: input.requestedByWorkerId?.trim() || 'ceo',
      requestedByRole: input.requestedByRole?.trim() || 'CEO',
      source: input.source?.trim() || 'Manual',
      priority: input.priority ?? 'P2',
      status: 'pending',
      decision: null,
      decisionReason: null,
      createdAt: now,
      updatedAt: now,
      decidedAt: null,
      relatedEpic: input.relatedEpic ?? null,
      relatedFeature: input.relatedFeature ?? null,
      relatedTask: input.relatedTask ?? null,
      riskLevel: input.riskLevel ?? 'medium',
      impactSummary: (input.impactSummary ?? '').trim()
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, approvals: [approval, ...snapshot.approvals] },
        'created',
        `New approval request: ${title}`
      )
    )
    return { success: true, data: approval }
  }

  // --- decisions -----------------------------------------------------------

  /** Update one approval, returning the changed item and the new list. */
  private withUpdated(
    snapshot: ApprovalSnapshot,
    id: string,
    mutate: (item: ApprovalItem) => ApprovalItem
  ): { item: ApprovalItem; approvals: ApprovalItem[] } | null {
    const index = snapshot.approvals.findIndex((a) => a.approvalId === id)
    if (index === -1) return null
    const item: ApprovalItem = { ...mutate(snapshot.approvals[index]), updatedAt: new Date().toISOString() }
    const approvals = [...snapshot.approvals]
    approvals[index] = item
    return { item, approvals }
  }

  private logTypeFor(decision: Exclude<ApprovalDecision, null>): ApprovalLogType {
    return decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'deferred'
  }

  /**
   * Record a decision on an approval. Sets status/decision/decidedAt, logs the
   * decision to the history, then notifies the Development OS: approvals and
   * rejections always append a DevOS event-log entry, and an approval that
   * impacts current work (has a related feature/task) also updates the DevOS
   * nextAction through DevOsRepository's public API.
   */
  private decide(
    id: string,
    decision: Exclude<ApprovalDecision, null>
  ): ApprovalOperationResult<ApprovalItem> {
    const snapshot = this.state.getSnapshot()
    const now = new Date().toISOString()
    const result = this.withUpdated(snapshot, id, (a) => ({
      ...a,
      status: decision,
      decision,
      decidedAt: now
    }))
    if (!result) return { success: false, error: 'approval not found' }

    this.commit(
      this.withLog(
        { ...snapshot, approvals: result.approvals },
        this.logTypeFor(decision),
        `${decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Deferred'}: ${result.item.title}`
      )
    )

    // Development OS integration (approve / reject only).
    const item = result.item
    if (decision === 'approved' && (item.relatedFeature || item.relatedTask)) {
      devOsRepository.setNextAction(`Proceed with approved work: ${item.title}`)
    } else if (decision === 'approved' || decision === 'rejected') {
      devOsRepository.recordEvent(`CEO ${decision} approval: ${item.title}`)
    }

    return { success: true, data: item }
  }

  approve(id: string): ApprovalOperationResult<ApprovalItem> {
    return this.decide(id, 'approved')
  }

  reject(id: string): ApprovalOperationResult<ApprovalItem> {
    return this.decide(id, 'rejected')
  }

  defer(id: string): ApprovalOperationResult<ApprovalItem> {
    return this.decide(id, 'deferred')
  }

  // --- decision reason -----------------------------------------------------

  addDecisionReason(id: string, reason: string): ApprovalOperationResult<ApprovalItem> {
    const text = reason.trim()
    if (!text) return { success: false, error: 'reason is empty' }
    const snapshot = this.state.getSnapshot()
    const result = this.withUpdated(snapshot, id, (a) => ({ ...a, decisionReason: text }))
    if (!result) return { success: false, error: 'approval not found' }
    this.commit(
      this.withLog(
        { ...snapshot, approvals: result.approvals },
        'reason-added',
        `Reason added for "${result.item.title}": ${text}`
      )
    )
    return { success: true, data: result.item }
  }

  clearDecisionReason(id: string): ApprovalOperationResult<ApprovalItem> {
    const snapshot = this.state.getSnapshot()
    const current = snapshot.approvals.find((a) => a.approvalId === id)
    if (!current) return { success: false, error: 'approval not found' }
    if (current.decisionReason === null) return { success: false, error: 'no decision reason' }
    const result = this.withUpdated(snapshot, id, (a) => ({ ...a, decisionReason: null }))
    if (!result) return { success: false, error: 'approval not found' }
    this.commit(
      this.withLog(
        { ...snapshot, approvals: result.approvals },
        'reason-cleared',
        `Reason cleared for "${result.item.title}"`
      )
    )
    return { success: true, data: result.item }
  }

  // --- CTO Room integration ------------------------------------------------

  /**
   * Import the CTO Room's currently-blocked decisions as pending approval
   * requests. Uses a deterministic id per decision so re-importing is safe (an
   * already-imported decision is skipped). Simple cross-service read — no shared
   * state, no redesign.
   */
  importFromCtoRoom(): ApprovalOperationResult<{ imported: number }> {
    const blocked = ctoRepository.getSnapshot().blockedDecisions.filter((d) => d.status === 'blocked')
    const snapshot = this.state.getSnapshot()
    const existing = new Set(snapshot.approvals.map((a) => a.approvalId))
    const now = new Date().toISOString()

    const created: ApprovalItem[] = []
    for (const decision of blocked) {
      const approvalId = `apr-cto-${decision.id}`
      if (existing.has(approvalId)) continue
      created.push({
        approvalId,
        title: decision.title,
        description: decision.context,
        category: categoryForDecision(`${decision.title} ${decision.context}`),
        requestedByWorkerId: 'cto',
        requestedByRole: 'CTO',
        source: 'CTO Room',
        priority: 'P1',
        status: 'pending',
        decision: null,
        decisionReason: null,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        relatedEpic: null,
        relatedFeature: null,
        relatedTask: null,
        riskLevel: 'high',
        impactSummary: `Blocked CTO decision awaiting ${decision.owner} sign-off.`
      })
    }

    if (created.length === 0) {
      return { success: true, data: { imported: 0 } }
    }
    this.commit(
      this.withLog(
        { ...snapshot, approvals: [...created, ...snapshot.approvals] },
        'imported',
        `Imported ${created.length} CTO blocked decision(s) as approval requests`
      )
    )
    return { success: true, data: { imported: created.length } }
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Approval Center back to the seed. */
  resetDemoState(): ApprovalOperationResult<ApprovalSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Approval Center reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const approvalRepository = new ApprovalRepository()
