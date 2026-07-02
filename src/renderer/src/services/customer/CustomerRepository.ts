import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import { CustomerEvents, type CustomerEventName } from './CustomerEvents'
import { CustomerState } from './CustomerState'
import { customerSeed } from './seed'
import type {
  ConsultationStage,
  ConsultationStep,
  CustomerLogEntry,
  CustomerLogType,
  CustomerPriority,
  CustomerRecord,
  CustomerSnapshot,
  CustomerSummary,
  FcCustomerSummary
} from './types'

export interface CustomerOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

/** The consultation funnel in order, with Korean labels for the checklist. */
const STAGE_ORDER: Array<{ stage: ConsultationStage; label: string }> = [
  { stage: 'first-contact', label: '최초 접촉' },
  { stage: 'needs-analysis', label: '니즈 분석' },
  { stage: 'policy-review', label: '증권 분석' },
  { stage: 'proposal', label: '제안' },
  { stage: 'closing', label: '클로징' },
  { stage: 'contract', label: '계약' },
  { stage: 'after-care', label: '사후관리' }
]

/** Statuses that count as a customer needing follow-up. */
const FOLLOW_UP_STATUSES = new Set(['follow-up', 'consulting', 'active'])

/** Canonical Jarvis query keys the Customer Workspace answers locally. */
export type CustomerJarvisQuery =
  | '고객 검색'
  | '오늘 연락할 고객'
  | '제안서 필요한 고객'
  | '미접촉 고객'
  | '계약 가능성 높은 고객'
  | 'FC별 고객 현황'

function cloneSeed(): CustomerSnapshot {
  return JSON.parse(JSON.stringify(customerSeed)) as CustomerSnapshot
}

/** Whole days between an ISO date and now; negative when the date is past. */
function daysFromNow(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.round((then - Date.now()) / 86_400_000)
}

/** True when a customer is due for contact today or overdue. */
export function isDueForContact(customer: CustomerRecord): boolean {
  const days = daysFromNow(customer.nextContactAt)
  return days !== null && days <= 0
}

/** A customer is "proposal ready" when at/near the proposal stage. */
export function isProposalReady(customer: CustomerRecord): boolean {
  return (
    customer.status === 'consulting' &&
    (customer.consultationStage === 'policy-review' ||
      customer.consultationStage === 'proposal' ||
      customer.consultationStage === 'closing')
  )
}

/**
 * Repository over the Customer Workspace. Same shape as FcRepository /
 * DevOsRepository: a state holder + event bus, mutations return a result and
 * persist through CustomerState. All customer/sales business logic lives here,
 * not in React components. Meaningful changes also append to the persisted event
 * log.
 *
 * Actions are safe and local only — no external API, no database. On first
 * initialisation it records a single, non-intrusive note into the Development OS
 * event log so the Live Company activity feed reflects that the Customer
 * Workspace exists; it never rewrites the active DevOS session or next action.
 * Assignment reuses the FC OS roster through fcRepository's public API.
 */
export class CustomerRepository {
  private seq = 0

  constructor(
    private readonly state = new CustomerState(),
    private readonly events = new CustomerEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): CustomerSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: CustomerEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: CustomerLogType, message: string): CustomerLogEntry {
    return { id: this.nextId('cusevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: CustomerSnapshot, type: CustomerLogType, message: string): CustomerSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: CustomerSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listCustomers(): CustomerRecord[] {
    return this.state.getSnapshot().customers
  }

  getCustomer(customerId: string): CustomerRecord | null {
    return this.state.getSnapshot().customers.find((c) => c.customerId === customerId) ?? null
  }

  getSelectedCustomer(): CustomerRecord | null {
    const { selectedCustomerId } = this.state.getSnapshot()
    return selectedCustomerId ? this.getCustomer(selectedCustomerId) : null
  }

  getEventLog(): CustomerLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Case-insensitive search over name, phone, FC and risk tags. */
  searchCustomers(query: string): CustomerRecord[] {
    const q = query.trim().toLowerCase()
    if (!q) return this.listCustomers()
    return this.listCustomers().filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.assignedFcName.toLowerCase().includes(q) ||
        c.team.toLowerCase().includes(q) ||
        c.riskTags.some((t) => t.toLowerCase().includes(q))
    )
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- rollups -------------------------------------------------------------

  /** Organization-wide customer summary. */
  getSummary(): CustomerSummary {
    const customers = this.listCustomers()
    const count = (predicate: (c: CustomerRecord) => boolean): number =>
      customers.filter(predicate).length
    return {
      total: customers.length,
      leads: count((c) => c.status === 'lead'),
      active: count((c) => c.status === 'active' || c.status === 'consulting'),
      consulting: count((c) => c.status === 'consulting'),
      proposalReady: count(isProposalReady),
      contracted: count((c) => c.status === 'contracted'),
      followUpNeeded: count((c) => FOLLOW_UP_STATUSES.has(c.status) && isDueForContact(c)),
      dormant: count((c) => c.status === 'dormant'),
      lost: count((c) => c.status === 'lost'),
      monthlyPremiumTotal: customers.reduce((sum, c) => sum + c.monthlyPremium, 0),
      totalPremiumTotal: customers.reduce((sum, c) => sum + c.totalPremium, 0),
      policyTotal: customers.reduce((sum, c) => sum + c.policyCount, 0)
    }
  }

  /** Per-FC customer rollup for the FC OS integration (only FCs with customers). */
  getFcCustomerSummaries(): FcCustomerSummary[] {
    const byFc = new Map<string, CustomerRecord[]>()
    for (const customer of this.listCustomers()) {
      const list = byFc.get(customer.assignedFcId) ?? []
      list.push(customer)
      byFc.set(customer.assignedFcId, list)
    }
    const summaries: FcCustomerSummary[] = []
    for (const [assignedFcId, customers] of byFc) {
      const head = customers[0]
      summaries.push({
        assignedFcId,
        assignedFcName: head.assignedFcName,
        team: head.team,
        total: customers.length,
        active: customers.filter((c) => c.status === 'active' || c.status === 'consulting').length,
        followUpNeeded: customers.filter((c) => FOLLOW_UP_STATUSES.has(c.status) && isDueForContact(c)).length,
        proposalReady: customers.filter(isProposalReady).length,
        dormant: customers.filter((c) => c.status === 'dormant').length,
        monthlyPremium: customers.reduce((sum, c) => sum + c.monthlyPremium, 0)
      })
    }
    return summaries.sort((a, b) => b.total - a.total)
  }

  /** Customer summary for a single FC (used by FC OS). */
  getFcCustomerSummary(fcId: string): FcCustomerSummary {
    const existing = this.getFcCustomerSummaries().find((s) => s.assignedFcId === fcId)
    if (existing) return existing
    return {
      assignedFcId: fcId,
      assignedFcName: fcRepository.getMember(fcId)?.name ?? fcId,
      team: fcRepository.getMember(fcId)?.team ?? '—',
      total: 0,
      active: 0,
      followUpNeeded: 0,
      proposalReady: 0,
      dormant: 0,
      monthlyPremium: 0
    }
  }

  /** Consultation checklist derived from a customer's current stage. */
  getConsultationChecklist(customerId: string): ConsultationStep[] {
    const customer = this.getCustomer(customerId)
    const currentIndex = customer
      ? STAGE_ORDER.findIndex((s) => s.stage === customer.consultationStage)
      : -1
    return STAGE_ORDER.map((s, i) => ({
      stage: s.stage,
      label: s.label,
      done: i < currentIndex,
      current: i === currentIndex
    }))
  }

  /** A short, human-readable next action for a customer. */
  getNextActionLabel(customer: CustomerRecord): string {
    if (customer.status === 'dormant') return '휴면 고객 — 재접촉 캠페인 검토'
    if (customer.status === 'lost') return '이탈 고객 — 리마케팅 후보'
    if (isDueForContact(customer)) return `오늘 연락 필요 (${customer.name})`
    const days = daysFromNow(customer.nextContactAt)
    if (days !== null && days > 0) return `${days}일 후 연락 예정`
    if (isProposalReady(customer)) return '제안서 준비 및 발송'
    return '다음 상담 일정 설정'
  }

  // --- selection -----------------------------------------------------------

  /** Open a customer in the workspace. */
  selectCustomer(customerId: string | null): CustomerOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (customerId && !snapshot.customers.some((c) => c.customerId === customerId)) {
      return { success: false, error: 'customer not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedCustomerId: customerId })
    this.events.emit('selection:changed', customerId)
    this.events.emit('snapshot:updated')
    return { success: true, data: customerId }
  }

  // --- mutations -----------------------------------------------------------

  private updateCustomer(
    customerId: string,
    mutate: (customer: CustomerRecord) => CustomerRecord,
    type: CustomerLogType,
    message: (customer: CustomerRecord) => string
  ): CustomerOperationResult<CustomerRecord> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.customers.findIndex((c) => c.customerId === customerId)
    if (index === -1) return { success: false, error: 'customer not found' }
    const nextCustomer: CustomerRecord = {
      ...mutate(snapshot.customers[index]),
      customerId,
      updatedAt: new Date().toISOString()
    }
    const customers = [...snapshot.customers]
    customers[index] = nextCustomer
    this.commit(this.withLog({ ...snapshot, customers }, type, message(nextCustomer)))
    this.events.emit('customer:updated', nextCustomer)
    return { success: true, data: nextCustomer }
  }

  /** Move a customer to a new consultation stage. */
  updateConsultationStage(
    customerId: string,
    consultationStage: ConsultationStage
  ): CustomerOperationResult<CustomerRecord> {
    return this.updateCustomer(
      customerId,
      (c) => ({ ...c, consultationStage }),
      'stage-updated',
      (c) => `${c.name} 상담 단계 → ${consultationStage}`
    )
  }

  /** Add a memo to a customer (also bumps memoCount + lastContactedAt). */
  addMemo(customerId: string, text: string, author = 'FC'): CustomerOperationResult<CustomerRecord> {
    const body = text.trim()
    if (!body) return { success: false, error: 'memo is empty' }
    const now = new Date().toISOString()
    return this.updateCustomer(
      customerId,
      (c) => {
        const memos = [{ id: this.nextId('memo'), text: body, author, createdAt: now }, ...c.memos]
        return { ...c, memos, memoCount: memos.length }
      },
      'memo-added',
      (c) => `${c.name} 메모 추가`
    )
  }

  /** Log a sales activity (also bumps activityCount + lastContactedAt). */
  addActivity(customerId: string, type: string, summary: string): CustomerOperationResult<CustomerRecord> {
    const body = summary.trim()
    if (!body) return { success: false, error: 'activity summary is empty' }
    const now = new Date().toISOString()
    return this.updateCustomer(
      customerId,
      (c) => {
        const activities = [
          { id: this.nextId('act'), type: type.trim() || 'note', summary: body, createdAt: now },
          ...c.activities
        ]
        return { ...c, activities, activityCount: activities.length, lastContactedAt: now }
      },
      'activity-added',
      (c) => `${c.name} 활동 기록: ${body}`
    )
  }

  /** Set the next scheduled contact date (ISO). */
  setNextContact(customerId: string, nextContactAt: string): CustomerOperationResult<CustomerRecord> {
    const value = nextContactAt.trim()
    if (!value) return { success: false, error: 'date is empty' }
    return this.updateCustomer(
      customerId,
      (c) => ({ ...c, nextContactAt: value }),
      'next-contact-set',
      (c) => `${c.name} 다음 연락일 설정`
    )
  }

  /** Reassign a customer to another FC, reusing the FC OS roster. */
  assignToFc(customerId: string, fcId: string): CustomerOperationResult<CustomerRecord> {
    const member = fcRepository.getMember(fcId)
    if (!member) return { success: false, error: 'FC not found' }
    return this.updateCustomer(
      customerId,
      (c) => ({ ...c, assignedFcId: member.fcId, assignedFcName: member.name, team: member.team }),
      'fc-assigned',
      (c) => `${c.name} → ${member.name} (${member.team}) 배정`
    )
  }

  /** Mark a customer's sales priority (defaults to high). */
  markPriority(customerId: string, priority: CustomerPriority = 'high'): CustomerOperationResult<CustomerRecord> {
    return this.updateCustomer(
      customerId,
      (c) => ({ ...c, priority }),
      'priority-updated',
      (c) => `${c.name} 우선순위 → ${priority}`
    )
  }

  /** Mark a customer dormant. */
  markDormant(customerId: string): CustomerOperationResult<CustomerRecord> {
    return this.updateCustomer(
      customerId,
      (c) => ({ ...c, status: 'dormant', nextContactAt: null }),
      'marked-dormant',
      (c) => `${c.name} 휴면 처리`
    )
  }

  /** Mark that a proposal was sent (status + stage move together). */
  markProposalSent(customerId: string): CustomerOperationResult<CustomerRecord> {
    const now = new Date().toISOString()
    return this.updateCustomer(
      customerId,
      (c) => {
        const activities = [
          { id: this.nextId('act'), type: 'proposal', summary: '제안서 발송', createdAt: now },
          ...c.activities
        ]
        return {
          ...c,
          status: 'proposal-sent',
          consultationStage: 'proposal',
          activities,
          activityCount: activities.length,
          lastContactedAt: now
        }
      },
      'proposal-sent',
      (c) => `${c.name} 제안서 발송`
    )
  }

  /** Mark a customer contracted (status + stage move together). */
  markContracted(customerId: string): CustomerOperationResult<CustomerRecord> {
    const now = new Date().toISOString()
    return this.updateCustomer(
      customerId,
      (c) => {
        const activities = [
          { id: this.nextId('act'), type: 'contract', summary: '계약 체결', createdAt: now },
          ...c.activities
        ]
        return {
          ...c,
          status: 'contracted',
          consultationStage: 'contract',
          activities,
          activityCount: activities.length,
          lastContactedAt: now
        }
      },
      'contracted',
      (c) => `${c.name} 계약 체결`
    )
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical Customer Workspace questions locally. This is
   * the seam a future Jarvis intent will call — it returns a ready-to-speak
   * Korean summary built from local data, with no external AI call. UI wiring is
   * left for a later sprint.
   */
  answerJarvisQuery(query: CustomerJarvisQuery, term = ''): string {
    switch (query) {
      case '고객 검색': {
        const found = this.searchCustomers(term)
        if (found.length === 0) return `"${term}" 검색 결과가 없습니다.`
        return `고객 검색 "${term}" · ${found.length}명 · ${found.slice(0, 5).map((c) => c.name).join(', ')}`
      }
      case '오늘 연락할 고객': {
        const due = this.listCustomers().filter(isDueForContact)
        return due.length === 0
          ? '오늘 연락할 고객이 없습니다.'
          : `오늘 연락할 고객 ${due.length}명 · ${due.map((c) => c.name).join(', ')}`
      }
      case '제안서 필요한 고객': {
        const ready = this.listCustomers().filter(isProposalReady)
        return ready.length === 0
          ? '제안서가 필요한 고객이 없습니다.'
          : `제안서 필요 고객 ${ready.length}명 · ${ready.map((c) => c.name).join(', ')}`
      }
      case '미접촉 고객': {
        const untouched = this.listCustomers().filter((c) => c.lastContactedAt === null)
        return untouched.length === 0
          ? '미접촉 고객이 없습니다.'
          : `미접촉 고객 ${untouched.length}명 · ${untouched.map((c) => c.name).join(', ')}`
      }
      case '계약 가능성 높은 고객': {
        const hot = this.listCustomers().filter(
          (c) => c.consultationStage === 'closing' || c.status === 'proposal-sent'
        )
        return hot.length === 0
          ? '계약 임박 고객이 없습니다.'
          : `계약 가능성 높은 고객 ${hot.length}명 · ${hot.map((c) => c.name).join(', ')}`
      }
      case 'FC별 고객 현황': {
        const summaries = this.getFcCustomerSummaries()
        return summaries.length === 0
          ? 'FC별 고객 데이터가 없습니다.'
          : `FC별 고객 현황 · ${summaries.map((s) => `${s.assignedFcName} ${s.total}명`).join(', ')}`
      }
      default:
        return '해당 질문을 아직 이해하지 못했습니다.'
    }
  }

  // --- company integration -------------------------------------------------

  /**
   * Record a one-time, non-intrusive note in the Development OS event log so the
   * Live Company activity feed shows the Customer Workspace foundation. Does not
   * touch the active DevOS session or next action. Called once on first init.
   */
  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Customer Workspace foundation created — customer workflow ready for future insurance analysis'
      )
    )
    devOsRepository.recordEvent(
      'Customer Workspace foundation created — next recommended action: build Sales Activity Workspace'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Customer Workspace back to the seed. */
  resetDemoState(): CustomerOperationResult<CustomerSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Customer Workspace demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const customerRepository = new CustomerRepository()
