import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { CtoEvents, type CtoEventName } from './CtoEvents'
import { CtoState } from './CtoState'
import { ctoSeed } from './seed'
import type {
  BlockedDecision,
  CtoLikelihood,
  CtoLogEntry,
  CtoLogType,
  CtoSeverity,
  CtoSnapshot,
  NextPriority,
  RiskItem,
  TechnicalDebtItem
} from './types'

export interface CtoOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

function cloneSeed(): CtoSnapshot {
  return JSON.parse(JSON.stringify(ctoSeed)) as CtoSnapshot
}

/**
 * Repository over the CTO Room. Same shape as PmRepository / DevOsRepository /
 * CompanyRepository: a state holder + event bus, mutations return a result and
 * persist through CtoState. All CTO governance logic lives here, not in React
 * components. Meaningful changes also append to the persisted event log.
 *
 * Actions are safe and local only — no external API, no database. Promoting a
 * priority is the one cross-service action: it drives the active Development OS
 * session through DevOsRepository's existing public API.
 */
export class CtoRepository {
  private seq = 0

  constructor(
    private readonly state = new CtoState(),
    private readonly events = new CtoEvents()
  ) {}

  getSnapshot(): CtoSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: CtoEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('room:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: CtoLogType, message: string): CtoLogEntry {
    return { id: this.nextId('ctoevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: CtoSnapshot, type: CtoLogType, message: string): CtoSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  /** Persist a new snapshot (already log-augmented) and notify subscribers. */
  private commit(snapshot: CtoSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listTechnicalDebt(): TechnicalDebtItem[] {
    return this.state.getSnapshot().technicalDebtItems
  }

  listRisks(): RiskItem[] {
    return this.state.getSnapshot().riskItems
  }

  listBlockedDecisions(): BlockedDecision[] {
    return this.state.getSnapshot().blockedDecisions
  }

  listNextPriorities(): NextPriority[] {
    return this.state.getSnapshot().nextPriorities
  }

  getEventLog(): CtoLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full CTO Room, for export. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- technical debt ------------------------------------------------------

  /** Add a new open technical-debt item. */
  addTechnicalDebt(input: {
    title: string
    area: string
    severity: CtoSeverity
  }): CtoOperationResult<TechnicalDebtItem> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'debt title is empty' }
    const now = new Date().toISOString()
    const item: TechnicalDebtItem = {
      id: this.nextId('debt'),
      title,
      area: input.area.trim() || 'General',
      severity: input.severity,
      status: 'open',
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, technicalDebtItems: [item, ...snapshot.technicalDebtItems] },
        'debt-added',
        `Added technical debt: ${title}`
      )
    )
    return { success: true, data: item }
  }

  /** Mark a technical-debt item resolved. */
  resolveTechnicalDebt(id: string): CtoOperationResult<TechnicalDebtItem> {
    const snapshot = this.state.getSnapshot()
    const item = snapshot.technicalDebtItems.find((d) => d.id === id)
    if (!item) return { success: false, error: 'debt item not found' }
    if (item.status === 'resolved') return { success: false, error: 'already resolved' }
    const next: TechnicalDebtItem = { ...item, status: 'resolved', updatedAt: new Date().toISOString() }
    const technicalDebtItems = snapshot.technicalDebtItems.map((d) => (d.id === id ? next : d))
    this.commit(
      this.withLog({ ...snapshot, technicalDebtItems }, 'debt-resolved', `Resolved technical debt: ${item.title}`)
    )
    return { success: true, data: next }
  }

  // --- risks ---------------------------------------------------------------

  /** Add a new open risk with its mitigation. */
  addRisk(input: {
    title: string
    area: string
    severity: CtoSeverity
    likelihood: CtoLikelihood
    mitigation: string
  }): CtoOperationResult<RiskItem> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'risk title is empty' }
    const now = new Date().toISOString()
    const item: RiskItem = {
      id: this.nextId('risk'),
      title,
      area: input.area.trim() || 'General',
      severity: input.severity,
      likelihood: input.likelihood,
      mitigation: input.mitigation.trim() || 'No mitigation defined yet.',
      status: 'open',
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog({ ...snapshot, riskItems: [item, ...snapshot.riskItems] }, 'risk-added', `Added risk: ${title}`)
    )
    return { success: true, data: item }
  }

  /** Mark a risk mitigated. */
  mitigateRisk(id: string): CtoOperationResult<RiskItem> {
    const snapshot = this.state.getSnapshot()
    const item = snapshot.riskItems.find((r) => r.id === id)
    if (!item) return { success: false, error: 'risk not found' }
    if (item.status === 'mitigated') return { success: false, error: 'already mitigated' }
    const next: RiskItem = { ...item, status: 'mitigated', updatedAt: new Date().toISOString() }
    const riskItems = snapshot.riskItems.map((r) => (r.id === id ? next : r))
    this.commit(this.withLog({ ...snapshot, riskItems }, 'risk-mitigated', `Mitigated risk: ${item.title}`))
    return { success: true, data: next }
  }

  // --- blocked decisions ---------------------------------------------------

  /** Add a decision blocked pending a CEO/CTO call. */
  addBlockedDecision(input: {
    title: string
    context: string
    owner: string
  }): CtoOperationResult<BlockedDecision> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'decision title is empty' }
    const now = new Date().toISOString()
    const decision: BlockedDecision = {
      id: this.nextId('decision'),
      title,
      context: input.context.trim(),
      owner: input.owner.trim() || 'CEO',
      status: 'blocked',
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, blockedDecisions: [decision, ...snapshot.blockedDecisions] },
        'decision-blocked',
        `Blocked decision added: ${title}`
      )
    )
    return { success: true, data: decision }
  }

  /** Clear a blocked decision (it has been made). */
  clearBlockedDecision(id: string): CtoOperationResult<BlockedDecision> {
    const snapshot = this.state.getSnapshot()
    const decision = snapshot.blockedDecisions.find((d) => d.id === id)
    if (!decision) return { success: false, error: 'decision not found' }
    if (decision.status === 'cleared') return { success: false, error: 'already cleared' }
    const next: BlockedDecision = { ...decision, status: 'cleared', updatedAt: new Date().toISOString() }
    const blockedDecisions = snapshot.blockedDecisions.map((d) => (d.id === id ? next : d))
    this.commit(
      this.withLog({ ...snapshot, blockedDecisions }, 'decision-cleared', `Cleared decision: ${decision.title}`)
    )
    return { success: true, data: next }
  }

  // --- priority promotion (DevOS integration) ------------------------------

  /**
   * Promote a queued CTO priority to the active Development OS session. Mirrors
   * the current work into the CTO Room's active epic/feature/task, records the
   * review timestamp, then drives the DevOS session (currentEpic / currentFeature
   * / currentTask / nextAction) through its existing public API so DevOS remains
   * the source of truth for "what we're working on now". The setNextAction call
   * also appends a DevOS event-log entry.
   */
  promoteNextPriority(id: string): CtoOperationResult<NextPriority> {
    const snapshot = this.state.getSnapshot()
    const priority = snapshot.nextPriorities.find((p) => p.id === id)
    if (!priority) return { success: false, error: 'priority not found' }

    const now = new Date().toISOString()
    const nextSnapshot: CtoSnapshot = {
      ...snapshot,
      activeEpic: priority.epic,
      activeFeature: priority.feature,
      activeTask: priority.task,
      lastReviewAt: now,
      // Remove the promoted priority from the queue now that it is active.
      nextPriorities: snapshot.nextPriorities.filter((p) => p.id !== id)
    }
    this.commit(
      this.withLog(nextSnapshot, 'priority-promoted', `Promoted CTO priority to active session: ${priority.title}`)
    )

    // Drive the Development OS session using its existing public API.
    devOsRepository.updateSession({
      status: 'active',
      currentEpic: priority.epic,
      currentFeature: priority.feature,
      currentTask: priority.task
    })
    devOsRepository.setNextAction(priority.nextAction || `Advance priority: ${priority.title}`)

    return { success: true, data: priority }
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the CTO Room back to the seed. */
  resetDemoState(): CtoOperationResult<CtoSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'CTO Room reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const ctoRepository = new CtoRepository()
