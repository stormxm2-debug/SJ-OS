import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { pmRepository } from '@renderer/services/pm/PmRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import type { ApprovalCategory } from '@renderer/services/approvals/types'
import { ImplementationEvents, type ImplementationEventName } from './ImplementationEvents'
import { ImplementationState } from './ImplementationState'
import { implementationSeed } from './seed'
import type {
  ImplementationLogEntry,
  ImplementationLogType,
  ImplementationPriority,
  ImplementationRequest,
  ImplementationRiskLevel,
  ImplementationSnapshot,
  ImplementationStatus,
  ImplementationSummary,
  NewImplementationInput,
  TargetWorkspace
} from './types'

export interface ImplementationOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 80

function cloneSeed(): ImplementationSnapshot {
  return JSON.parse(JSON.stringify(implementationSeed)) as ImplementationSnapshot
}

/** Statuses that still need work before Autopilot can act. */
const PENDING_STATUSES = new Set<ImplementationStatus>([
  'drafted',
  'planned',
  'waiting-for-approval'
])

/** Map a target workspace onto the Approval Center category. */
function approvalCategoryFor(workspace: TargetWorkspace): ApprovalCategory {
  switch (workspace) {
    case 'insurance-analysis':
      return 'insurance-analysis'
    case 'customer':
      return 'customer-data'
    case 'autopilot':
      return 'automation'
    default:
      return 'product'
  }
}

/** Priority rank for ordering (lower = more urgent). */
const PRIORITY_RANK: Record<ImplementationPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/**
 * Repository over the Implementation Request queue. Same shape as the other SJ
 * OS repositories: a state holder + event bus, mutations return a result and
 * persist through ImplementationState.
 *
 * This is the safety layer that lets Jarvis act as a command controller WITHOUT
 * editing source files, running git, or calling external APIs. A CEO command
 * becomes a structured request that is routed locally into the existing
 * development operating system: a PM Planner backlog item is created, an
 * Approval Center request is raised when approval is required, and a Development
 * OS / Live Company event is recorded. Autopilot can then read the queue through
 * the exposed getters and promote approved requests in a future operating loop.
 */
export class ImplementationRepository {
  private seq = 0

  constructor(
    private readonly state = new ImplementationState(),
    private readonly events = new ImplementationEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): ImplementationSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: ImplementationEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: ImplementationLogType, message: string): ImplementationLogEntry {
    return { id: this.nextId('implevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: ImplementationSnapshot,
    type: ImplementationLogType,
    message: string
  ): ImplementationSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: ImplementationSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listRequests(): ImplementationRequest[] {
    return this.state.getSnapshot().requests
  }

  getRequest(requestId: string): ImplementationRequest | null {
    return this.state.getSnapshot().requests.find((r) => r.requestId === requestId) ?? null
  }

  getSelectedRequest(): ImplementationRequest | null {
    const { selectedRequestId } = this.state.getSnapshot()
    return selectedRequestId ? this.getRequest(selectedRequestId) : null
  }

  getEventLog(): ImplementationLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full queue, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  /** Organization-wide implementation-request rollup. */
  getSummary(): ImplementationSummary {
    const list = this.listRequests()
    const count = (status: ImplementationStatus): number =>
      list.filter((r) => r.status === status).length
    return {
      total: list.length,
      drafted: count('drafted'),
      planned: count('planned'),
      waitingForApproval: count('waiting-for-approval'),
      approved: count('approved'),
      promotedToDevos: count('promoted-to-devos'),
      inProgress: count('in-progress'),
      completed: count('completed'),
      rejected: count('rejected'),
      deferred: count('deferred'),
      readyToPromote: this.getReadyToPromote().length
    }
  }

  // --- Autopilot-readable views --------------------------------------------

  /** Requests still working through planning / approval (not yet actionable). */
  getPendingRequests(): ImplementationRequest[] {
    return this.listRequests().filter((r) => PENDING_STATUSES.has(r.status))
  }

  /** Requests explicitly approved and awaiting promotion. */
  getApprovedRequests(): ImplementationRequest[] {
    return this.listRequests().filter((r) => r.status === 'approved')
  }

  /**
   * Requests Autopilot may promote next: explicitly approved, or planned with no
   * approval required. Sorted most-urgent first.
   */
  getReadyToPromote(): ImplementationRequest[] {
    return this.listRequests()
      .filter((r) => r.status === 'approved' || (r.status === 'planned' && !r.approvalRequired))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
  }

  /** The single next request Autopilot should promote (null if none ready). */
  getNextToPromote(): ImplementationRequest | null {
    return this.getReadyToPromote()[0] ?? null
  }

  // --- selection -----------------------------------------------------------

  selectRequest(requestId: string | null): ImplementationOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (requestId && !snapshot.requests.some((r) => r.requestId === requestId)) {
      return { success: false, error: 'request not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedRequestId: requestId })
    this.events.emit('selection:changed', requestId)
    this.events.emit('snapshot:updated')
    return { success: true, data: requestId }
  }

  // --- create + route ------------------------------------------------------

  /**
   * Raise and route an implementation request from a Jarvis command in one safe
   * step. Creates the request (drafted), then routes it: creates a PM Planner
   * backlog item, raises an Approval Center request when approval is required,
   * and records a Development OS / Live Company event. Returns the routed
   * request. No files are edited and no git runs.
   */
  submitCommand(input: NewImplementationInput): ImplementationOperationResult<ImplementationRequest> {
    const raw = input.rawUserCommand.trim()
    if (!raw) return { success: false, error: 'command is empty' }
    const now = new Date().toISOString()
    const priority = input.priority ?? 'P2'
    const riskLevel = input.riskLevel ?? 'low'
    const approvalRequired = input.approvalRequired ?? false
    const targetWorkspace = input.targetWorkspace ?? 'unknown'
    const interpretedGoal = (input.interpretedGoal ?? raw).trim()
    const title = (input.title ?? raw).trim().slice(0, 80)

    const request: ImplementationRequest = {
      requestId: this.nextId('impl'),
      title,
      rawUserCommand: raw,
      interpretedGoal,
      targetWorkspace,
      priority,
      status: 'drafted',
      requestedBy: input.requestedBy ?? 'CEO (Jarvis)',
      createdAt: now,
      updatedAt: now,
      pmPlanId: null,
      relatedEpic: null,
      relatedFeature: null,
      relatedTask: null,
      approvalRequired,
      approvalId: null,
      riskLevel,
      nextAction: '라우팅 준비',
      routeTarget: 'PM Planner',
      routingLog: []
    }

    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, requests: [request, ...snapshot.requests], selectedRequestId: request.requestId },
        'created',
        `구현 요청 생성: ${title}`
      )
    )

    return this.route(request.requestId)
  }

  /**
   * Route (or re-route) a drafted request through the development operating
   * system. Idempotent-ish: it will not create a second PM backlog item or a
   * second approval if they already exist.
   */
  route(requestId: string): ImplementationOperationResult<ImplementationRequest> {
    const current = this.getRequest(requestId)
    if (!current) return { success: false, error: 'request not found' }

    const routingLog: string[] = [...current.routingLog]
    let pmPlanId = current.pmPlanId
    let approvalId = current.approvalId

    // 1) PM Planner backlog item (safe local intake).
    if (!pmPlanId) {
      const pm = pmRepository.addBacklogItem({
        title: `[Jarvis] ${current.title}`,
        description: `${current.interpretedGoal}\n\n원본 명령: ${current.rawUserCommand}\n대상: ${current.targetWorkspace}`,
        priority: current.priority
      })
      if (pm.success && pm.data) {
        pmPlanId = pm.data.id
        routingLog.push(`PM Planner 백로그 생성: ${pm.data.id}`)
      }
    }

    // 2) Approval Center request when approval is required (or high risk).
    const needsApproval = current.approvalRequired || current.riskLevel === 'high' || current.riskLevel === 'critical'
    if (needsApproval && !approvalId) {
      const approval = approvalRepository.createApproval({
        title: `[구현 요청] ${current.title}`,
        description: current.interpretedGoal,
        category: approvalCategoryFor(current.targetWorkspace),
        requestedByWorkerId: 'jarvis',
        requestedByRole: 'Jarvis',
        source: 'Jarvis Implementation',
        priority: current.priority,
        riskLevel: current.riskLevel === 'critical' ? 'critical' : current.riskLevel === 'high' ? 'high' : 'medium',
        impactSummary: `대상 워크스페이스: ${current.targetWorkspace} · 원본: ${current.rawUserCommand}`
      })
      if (approval.success && approval.data) {
        approvalId = approval.data.approvalId
        routingLog.push(`Approval Center 요청 생성: ${approval.data.approvalId}`)
      }
    }

    // 3) Resolve routed status + target.
    const status: ImplementationStatus = needsApproval ? 'waiting-for-approval' : 'planned'
    const routeTarget = needsApproval ? 'Approval Center' : 'Autopilot (ready to promote)'
    const nextAction = needsApproval
      ? 'CEO 승인 대기 — Approval Center에서 검토'
      : 'Autopilot 승격 대기 — PM Planner에서 계획 생성 가능'

    // 4) Development OS / Live Company event (safe, non-intrusive record only).
    devOsRepository.recordEvent(
      `Jarvis 구현 요청 라우팅: "${current.title}" → ${routeTarget} (${current.targetWorkspace}, ${current.priority})`
    )
    routingLog.push(`Development OS 이벤트 기록`)

    const outcome = this.updateRequest(
      requestId,
      (r) => ({ ...r, status, routeTarget, nextAction, pmPlanId, approvalId, routingLog }),
      needsApproval ? 'approval-requested' : 'planned',
      (r) => `구현 요청 라우팅: ${r.title} → ${routeTarget}`
    )
    this.commit(this.withLog(this.state.getSnapshot(), 'routed', `라우팅 완료: ${current.title}`))
    return outcome
  }

  // --- shared mutation -----------------------------------------------------

  private updateRequest(
    requestId: string,
    mutate: (r: ImplementationRequest) => ImplementationRequest,
    type: ImplementationLogType,
    message: (r: ImplementationRequest) => string
  ): ImplementationOperationResult<ImplementationRequest> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.requests.findIndex((r) => r.requestId === requestId)
    if (index === -1) return { success: false, error: 'request not found' }
    const next: ImplementationRequest = {
      ...mutate(snapshot.requests[index]),
      requestId,
      updatedAt: new Date().toISOString()
    }
    const requests = [...snapshot.requests]
    requests[index] = next
    this.commit(this.withLog({ ...snapshot, requests }, type, message(next)))
    this.events.emit('request:updated', next)
    return { success: true, data: next }
  }

  // --- lifecycle -----------------------------------------------------------

  approveRequest(requestId: string): ImplementationOperationResult<ImplementationRequest> {
    return this.updateRequest(
      requestId,
      (r) => ({ ...r, status: 'approved', routeTarget: 'Autopilot (ready to promote)', nextAction: 'Autopilot 승격 대기' }),
      'approved',
      (r) => `구현 요청 승인: ${r.title}`
    )
  }

  rejectRequest(requestId: string): ImplementationOperationResult<ImplementationRequest> {
    return this.updateRequest(
      requestId,
      (r) => ({ ...r, status: 'rejected', routeTarget: '—', nextAction: '반려됨' }),
      'rejected',
      (r) => `구현 요청 반려: ${r.title}`
    )
  }

  deferRequest(requestId: string): ImplementationOperationResult<ImplementationRequest> {
    return this.updateRequest(
      requestId,
      (r) => ({ ...r, status: 'deferred', nextAction: '다음 스프린트로 연기' }),
      'deferred',
      (r) => `구현 요청 연기: ${r.title}`
    )
  }

  /**
   * Promote a ready request into the Development OS operating loop. Records a
   * DevOS event; it does not overwrite the active DevOS session (safe).
   */
  promoteToDevos(requestId: string): ImplementationOperationResult<ImplementationRequest> {
    const current = this.getRequest(requestId)
    if (!current) return { success: false, error: 'request not found' }
    if (current.status !== 'approved' && !(current.status === 'planned' && !current.approvalRequired)) {
      return { success: false, error: 'request is not ready to promote' }
    }
    devOsRepository.recordEvent(`Autopilot 승격: 구현 요청 "${current.title}" → Development OS 대기열`)
    return this.updateRequest(
      requestId,
      (r) => ({ ...r, status: 'promoted-to-devos', routeTarget: 'Development OS', nextAction: 'DevOS 작업 대기열 진입' }),
      'promoted-to-devos',
      (r) => `구현 요청 DevOS 승격: ${r.title}`
    )
  }

  setStatus(
    requestId: string,
    status: ImplementationStatus
  ): ImplementationOperationResult<ImplementationRequest> {
    return this.updateRequest(
      requestId,
      (r) => ({ ...r, status }),
      'status-changed',
      (r) => `구현 요청 상태 → ${status}: ${r.title}`
    )
  }

  // --- company integration -------------------------------------------------

  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Implementation Request domain created — Jarvis can now route CEO commands into PM/Approval/DevOS/Autopilot'
      )
    )
    devOsRepository.recordEvent(
      'Jarvis Implementation Request mode created — CEO commands can now be routed into the development operating system'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Implementation Request queue back to empty. */
  resetDemoState(): ImplementationOperationResult<ImplementationSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Implementation Request queue reset')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const implementationRepository = new ImplementationRepository()
