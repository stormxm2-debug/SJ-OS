import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import { ConsultationEvents, type ConsultationEventName } from './ConsultationEvents'
import { ConsultationState } from './ConsultationState'
import { consultationSeed } from './seed'
import {
  FLOW_TO_CUSTOMER_STAGE,
  ORDERED_STAGES,
  type Consultation,
  type ConsultationFlowStage,
  type ConsultationLogEntry,
  type ConsultationLogType,
  type ConsultationSnapshot,
  type ConsultationStatus,
  type ConsultationSummary,
  type StageEntry,
  type StageFunnelRow,
  type StageStatus
} from './types'

export interface ConsultationOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Fields a caller supplies to open a new consultation. */
export interface NewConsultationInput {
  customerId: string
  startStage?: ConsultationFlowStage
  nextAction?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

const DEFAULT_CHECKLIST = [
  '고객 기본정보 확인',
  '재무상황/니즈 청취',
  '보유 증권 분석',
  '설계안 제안',
  '청약 서류 준비',
  '계약 체결',
  '증권 전달 및 사후관리 안내'
]

/** Canonical Jarvis query keys the Consultation Workspace answers locally. */
export type ConsultationJarvisQuery =
  | '진행중 상담'
  | '클로징 단계 상담'
  | '상담 성공률'
  | '단계별 상담 현황'
  | '사후관리 대상'
  | '다음 상담 액션'

function cloneSeed(): ConsultationSnapshot {
  return JSON.parse(JSON.stringify(consultationSeed)) as ConsultationSnapshot
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/** A consultation is still open while active or on-hold. */
export function isOpenConsultation(c: Consultation): boolean {
  return c.status === 'active' || c.status === 'on-hold'
}

/** Count of stages marked done. */
export function completedStageCount(c: Consultation): number {
  return c.stages.filter((s) => s.status === 'done').length
}

/**
 * Repository over the Consultation Workspace. Same shape as
 * TeamLeaderRepository / ScheduleRepository: a state holder + event bus,
 * mutations return a result and persist through ConsultationState. All
 * consultation-flow business logic lives here, not in React components.
 *
 * Actions are safe and local only — no external API, no database. Opening a
 * consultation reuses the Customer Workspace roster; advancing into the
 * closing/contract/after-care stages pushes the matching stage back onto the
 * customer through the Customer Workspace public API, and completing the
 * contract stage logs a contract activity on the customer timeline. On first
 * initialisation it records a single, non-intrusive note into the Development OS
 * event log; it never rewrites the active DevOS session or next action.
 */
export class ConsultationRepository {
  private seq = 0

  constructor(
    private readonly state = new ConsultationState(),
    private readonly events = new ConsultationEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): ConsultationSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: ConsultationEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: ConsultationLogType, message: string): ConsultationLogEntry {
    return { id: this.nextId('conevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: ConsultationSnapshot,
    type: ConsultationLogType,
    message: string
  ): ConsultationSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: ConsultationSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listConsultations(): Consultation[] {
    return this.state.getSnapshot().consultations
  }

  getConsultation(consultationId: string): Consultation | null {
    return (
      this.state.getSnapshot().consultations.find((c) => c.consultationId === consultationId) ?? null
    )
  }

  getSelectedConsultation(): Consultation | null {
    const { selectedConsultationId } = this.state.getSnapshot()
    return selectedConsultationId ? this.getConsultation(selectedConsultationId) : null
  }

  getByCustomer(customerId: string): Consultation | null {
    return this.state.getSnapshot().consultations.find((c) => c.customerId === customerId) ?? null
  }

  getEventLog(): ConsultationLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- rollups -------------------------------------------------------------

  /** Organization-wide consultation summary. */
  getSummary(): ConsultationSummary {
    const list = this.listConsultations()
    const count = (predicate: (c: Consultation) => boolean): number => list.filter(predicate).length
    const won = count((c) => c.status === 'won')
    const lost = count((c) => c.status === 'lost')
    const active = list.filter((c) => c.status === 'active')
    const avgProgress =
      active.length > 0
        ? Math.round(
            (active.reduce((sum, c) => sum + completedStageCount(c), 0) / active.length) * 10
          ) / 10
        : 0
    return {
      total: list.length,
      active: active.length,
      won,
      lost,
      onHold: count((c) => c.status === 'on-hold'),
      closingStage: count((c) => c.currentStage === 'closing' && isOpenConsultation(c)),
      proposalStage: count((c) => c.currentStage === 'proposal' && isOpenConsultation(c)),
      afterCare: count((c) => c.currentStage === 'after-care'),
      winRate: rate(won, won + lost),
      avgProgress
    }
  }

  /** Per-stage funnel: how many sit at each stage, how many have completed it. */
  getStageFunnel(): StageFunnelRow[] {
    const list = this.listConsultations()
    return ORDERED_STAGES.map<StageFunnelRow>((stage) => ({
      stage,
      count: list.filter((c) => c.currentStage === stage).length,
      completed: list.filter((c) => c.stages.find((s) => s.stage === stage)?.status === 'done').length
    }))
  }

  // --- selection -----------------------------------------------------------

  selectConsultation(consultationId: string | null): ConsultationOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (consultationId && !snapshot.consultations.some((c) => c.consultationId === consultationId)) {
      return { success: false, error: 'consultation not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedConsultationId: consultationId })
    this.events.emit('selection:changed', consultationId)
    this.events.emit('snapshot:updated')
    return { success: true, data: consultationId }
  }

  // --- create --------------------------------------------------------------

  createConsultation(input: NewConsultationInput): ConsultationOperationResult<Consultation> {
    const customer = customerRepository.getCustomer(input.customerId)
    if (!customer) return { success: false, error: 'customer not found' }
    if (this.getByCustomer(customer.customerId)) {
      return { success: false, error: 'consultation already exists for customer' }
    }
    const start = input.startStage ?? 'first-meeting'
    const startIndex = ORDERED_STAGES.indexOf(start)
    const now = new Date().toISOString()
    const stages: StageEntry[] = ORDERED_STAGES.map<StageEntry>((stage, index) => ({
      stage,
      status: index < startIndex ? 'done' : index === startIndex ? 'active' : 'pending',
      completedAt: index < startIndex ? now : null,
      note: ''
    }))
    const consultation: Consultation = {
      consultationId: this.nextId('con'),
      customerId: customer.customerId,
      customerName: customer.name,
      fcId: customer.assignedFcId,
      fcName: customer.assignedFcName,
      team: customer.team,
      status: 'active',
      currentStage: start,
      stages,
      checklist: DEFAULT_CHECKLIST.map((label, index) => ({
        id: this.nextId('chk'),
        label,
        done: index < startIndex
      })),
      notes: [],
      nextAction: (input.nextAction ?? '').trim(),
      nextActionAt: null,
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, consultations: [consultation, ...snapshot.consultations] },
        'created',
        `새 상담 개설: ${customer.name}`
      )
    )
    return { success: true, data: consultation }
  }

  // --- shared mutation -----------------------------------------------------

  private updateConsultation(
    consultationId: string,
    mutate: (c: Consultation) => Consultation,
    type: ConsultationLogType,
    message: (c: Consultation) => string
  ): ConsultationOperationResult<Consultation> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.consultations.findIndex((c) => c.consultationId === consultationId)
    if (index === -1) return { success: false, error: 'consultation not found' }
    const next: Consultation = {
      ...mutate(snapshot.consultations[index]),
      consultationId,
      updatedAt: new Date().toISOString()
    }
    const consultations = [...snapshot.consultations]
    consultations[index] = next
    this.commit(this.withLog({ ...snapshot, consultations }, type, message(next)))
    this.events.emit('consultation:updated', next)
    return { success: true, data: next }
  }

  // --- stage flow ----------------------------------------------------------

  /**
   * Advance to the next stage: mark the current stage done and activate the
   * next. When entering closing/contract/after-care, sync the matching stage
   * onto the linked customer; completing the contract stage also logs a contract
   * activity on the customer timeline.
   */
  advanceStage(consultationId: string): ConsultationOperationResult<Consultation> {
    const current = this.getConsultation(consultationId)
    if (!current) return { success: false, error: 'consultation not found' }
    const idx = ORDERED_STAGES.indexOf(current.currentStage)
    if (idx >= ORDERED_STAGES.length - 1) {
      // Already at after-care — just mark it done.
      return this.setStageStatus(consultationId, current.currentStage, 'done')
    }
    const nextStage = ORDERED_STAGES[idx + 1]
    const now = new Date().toISOString()
    const outcome = this.updateConsultation(
      consultationId,
      (c) => ({
        ...c,
        currentStage: nextStage,
        stages: c.stages.map<StageEntry>((s) => {
          if (s.stage === c.currentStage) return { ...s, status: 'done', completedAt: now }
          if (s.stage === nextStage) return { ...s, status: 'active' }
          return s
        })
      }),
      'stage-advanced',
      (c) => `${c.customerName} 상담 단계 진행 → ${nextStage}`
    )
    if (outcome.success && outcome.data) {
      this.syncCustomerStage(outcome.data, nextStage)
      if (nextStage === 'contract') {
        customerRepository.addActivity(outcome.data.customerId, 'contract', `${outcome.data.customerName} 계약 단계 진입`)
      }
    }
    return outcome
  }

  /** Set an explicit status on a specific stage. */
  setStageStatus(
    consultationId: string,
    stage: ConsultationFlowStage,
    status: StageStatus
  ): ConsultationOperationResult<Consultation> {
    const now = new Date().toISOString()
    return this.updateConsultation(
      consultationId,
      (c) => ({
        ...c,
        currentStage: status === 'active' ? stage : c.currentStage,
        stages: c.stages.map<StageEntry>((s) =>
          s.stage === stage
            ? { ...s, status, completedAt: status === 'done' ? s.completedAt ?? now : null }
            : s
        )
      }),
      'stage-updated',
      (c) => `${c.customerName} · ${stage} → ${status}`
    )
  }

  /** Attach a short note to a specific stage. */
  setStageNote(
    consultationId: string,
    stage: ConsultationFlowStage,
    note: string
  ): ConsultationOperationResult<Consultation> {
    return this.updateConsultation(
      consultationId,
      (c) => ({
        ...c,
        stages: c.stages.map<StageEntry>((s) => (s.stage === stage ? { ...s, note: note.trim() } : s))
      }),
      'stage-updated',
      (c) => `${c.customerName} · ${stage} 메모 업데이트`
    )
  }

  private syncCustomerStage(consultation: Consultation, stage: ConsultationFlowStage): void {
    const customerStage = FLOW_TO_CUSTOMER_STAGE[stage]
    customerRepository.updateConsultationStage(consultation.customerId, customerStage)
  }

  /** Push the current stage onto the linked customer (Customer Workspace). */
  syncToCustomer(consultationId: string): ConsultationOperationResult<Consultation> {
    const consultation = this.getConsultation(consultationId)
    if (!consultation) return { success: false, error: 'consultation not found' }
    this.syncCustomerStage(consultation, consultation.currentStage)
    return this.updateConsultation(
      consultationId,
      (c) => ({ ...c }),
      'customer-synced',
      (c) => `${c.customerName} 상담 단계 고객 반영: ${FLOW_TO_CUSTOMER_STAGE[c.currentStage]}`
    )
  }

  // --- checklist -----------------------------------------------------------

  toggleChecklistItem(
    consultationId: string,
    itemId: string
  ): ConsultationOperationResult<Consultation> {
    return this.updateConsultation(
      consultationId,
      (c) => ({
        ...c,
        checklist: c.checklist.map((item) =>
          item.id === itemId ? { ...item, done: !item.done } : item
        )
      }),
      'checklist-toggled',
      (c) => `${c.customerName} 체크리스트 업데이트`
    )
  }

  addChecklistItem(consultationId: string, label: string): ConsultationOperationResult<Consultation> {
    const text = label.trim()
    if (!text) return { success: false, error: 'label is empty' }
    return this.updateConsultation(
      consultationId,
      (c) => ({
        ...c,
        checklist: [...c.checklist, { id: this.nextId('chk'), label: text, done: false }]
      }),
      'checklist-toggled',
      (c) => `${c.customerName} 체크리스트 항목 추가`
    )
  }

  // --- notes + next action -------------------------------------------------

  addNote(consultationId: string, text: string, author = 'FC'): ConsultationOperationResult<Consultation> {
    const body = text.trim()
    if (!body) return { success: false, error: 'note is empty' }
    return this.updateConsultation(
      consultationId,
      (c) => ({
        ...c,
        notes: [
          { id: this.nextId('note'), author, text: body, createdAt: new Date().toISOString() },
          ...c.notes
        ]
      }),
      'note-added',
      (c) => `${c.customerName} 상담 노트 추가`
    )
  }

  updateNextAction(
    consultationId: string,
    nextAction: string,
    nextActionAt: string | null = null
  ): ConsultationOperationResult<Consultation> {
    return this.updateConsultation(
      consultationId,
      (c) => ({ ...c, nextAction: nextAction.trim(), nextActionAt: nextActionAt ?? c.nextActionAt }),
      'next-action-updated',
      (c) => `${c.customerName} 다음 액션 업데이트`
    )
  }

  // --- lifecycle -----------------------------------------------------------

  setStatus(consultationId: string, status: ConsultationStatus): ConsultationOperationResult<Consultation> {
    const type: ConsultationLogType =
      status === 'won' ? 'won' : status === 'lost' ? 'lost' : status === 'on-hold' ? 'on-hold' : 'stage-updated'
    return this.updateConsultation(
      consultationId,
      (c) => ({ ...c, status }),
      type,
      (c) => `${c.customerName} 상담 상태 → ${status}`
    )
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical Consultation questions locally. This is the seam
   * a future Jarvis intent will call — it returns a ready-to-speak Korean
   * summary built from local data, with no external AI call. UI wiring is left
   * for a later sprint.
   */
  answerJarvisQuery(query: ConsultationJarvisQuery): string {
    const s = this.getSummary()
    switch (query) {
      case '진행중 상담':
        return `진행중 상담 ${s.active}건 · 보류 ${s.onHold}건`
      case '클로징 단계 상담': {
        const closing = this.listConsultations().filter(
          (c) => c.currentStage === 'closing' && isOpenConsultation(c)
        )
        return closing.length === 0
          ? '클로징 단계 상담이 없습니다.'
          : `클로징 단계 ${closing.length}건 · ${closing.map((c) => c.customerName).join(', ')}`
      }
      case '상담 성공률':
        return `상담 성공률 ${s.winRate}% · 성공 ${s.won}건 / 실패 ${s.lost}건`
      case '단계별 상담 현황':
        return `단계별 현황 · ${this.getStageFunnel()
          .filter((r) => r.count > 0)
          .map((r) => `${r.stage} ${r.count}`)
          .join(', ')}`
      case '사후관리 대상': {
        const care = this.listConsultations().filter((c) => c.currentStage === 'after-care')
        return care.length === 0
          ? '사후관리 대상이 없습니다.'
          : `사후관리 대상 ${care.length}건 · ${care.map((c) => c.customerName).join(', ')}`
      }
      case '다음 상담 액션': {
        const open = this.listConsultations().filter((c) => isOpenConsultation(c) && c.nextAction)
        return open.length === 0
          ? '예정된 상담 액션이 없습니다.'
          : `상담 다음 액션 ${open.length}건 · ${open.map((c) => `${c.customerName}: ${c.nextAction}`).join(' / ')}`
      }
      default:
        return '해당 질문을 아직 이해하지 못했습니다.'
    }
  }

  // --- company integration -------------------------------------------------

  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Consultation Workspace foundation created — customer consultation flow ready for future Jarvis reporting'
      )
    )
    devOsRepository.recordEvent(
      'Consultation Workspace foundation created — next recommended action: build Insurance Analysis Entry'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Consultation Workspace back to the seed. */
  resetDemoState(): ConsultationOperationResult<ConsultationSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Consultation Workspace demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const consultationRepository = new ConsultationRepository()
