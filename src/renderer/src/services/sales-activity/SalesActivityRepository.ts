import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import { SalesActivityEvents, type SalesActivityEventName } from './SalesActivityEvents'
import { SalesActivityState } from './SalesActivityState'
import { salesActivitySeed } from './seed'
import type {
  ActivityPriority,
  ActivityStatus,
  ActivityType,
  CustomerActivitySummary,
  FcActivityRank,
  SalesActivity,
  SalesActivityFilter,
  SalesActivityLogEntry,
  SalesActivityLogType,
  SalesActivitySnapshot,
  SalesActivitySummary,
  TeamActivitySummary
} from './types'

export interface SalesActivityOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Fields a caller supplies to create a new activity. */
export interface NewActivityInput {
  fcId: string
  customerId?: string | null
  type: ActivityType
  title: string
  description?: string
  priority?: ActivityPriority
  scheduledAt?: string | null
  location?: string
  nextAction?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

/** Canonical Jarvis query keys the Sales Activity Workspace answers locally. */
export type SalesActivityJarvisQuery =
  | '오늘 영업활동'
  | 'FC별 활동 현황'
  | '미완료 활동'
  | '클로징 예정 고객'
  | '오늘 AP 현황'
  | '기고객 관리 대상'
  | '팀별 활동 순위'

const TERMINAL_STATUSES = new Set<ActivityStatus>(['completed', 'cancelled'])

function cloneSeed(): SalesActivitySnapshot {
  return JSON.parse(JSON.stringify(salesActivitySeed)) as SalesActivitySnapshot
}

/** True when an ISO date falls on the current calendar day (local time). */
export function isToday(iso: string | null): boolean {
  if (!iso) return false
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

/** An activity is still open when it hasn't reached a terminal status. */
export function isOpen(activity: SalesActivity): boolean {
  return !TERMINAL_STATUSES.has(activity.status)
}

/** True when an open activity's next-action date is in the past. */
export function isOverdue(activity: SalesActivity): boolean {
  if (!isOpen(activity)) return false
  if (activity.status === 'needs-follow-up') return true
  if (!activity.nextActionAt) return false
  const due = new Date(activity.nextActionAt).getTime()
  return !Number.isNaN(due) && due < Date.now()
}

/** True when the activity needs follow-up (explicit status or overdue). */
export function needsFollowUp(activity: SalesActivity): boolean {
  return activity.status === 'needs-follow-up' || isOverdue(activity)
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/**
 * Repository over the Sales Activity Workspace. Same shape as CustomerRepository
 * / FcRepository: a state holder + event bus, mutations return a result and
 * persist through SalesActivityState. All sales-activity business logic lives
 * here, not in React components. Meaningful changes also append to the persisted
 * event log.
 *
 * Actions are safe and local only — no external API, no database. Activity
 * creation and assignment reuse the FC OS roster and Customer Workspace through
 * their public APIs; completing a customer-linked activity appends to that
 * customer's timeline. On first initialisation it records a single,
 * non-intrusive note into the Development OS event log (Live Company feed); it
 * never rewrites the active DevOS session or next action.
 */
export class SalesActivityRepository {
  private seq = 0

  constructor(
    private readonly state = new SalesActivityState(),
    private readonly events = new SalesActivityEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): SalesActivitySnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: SalesActivityEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: SalesActivityLogType, message: string): SalesActivityLogEntry {
    return { id: this.nextId('saevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: SalesActivitySnapshot,
    type: SalesActivityLogType,
    message: string
  ): SalesActivitySnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: SalesActivitySnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listActivities(): SalesActivity[] {
    return this.state.getSnapshot().activities
  }

  getActivity(activityId: string): SalesActivity | null {
    return this.state.getSnapshot().activities.find((a) => a.activityId === activityId) ?? null
  }

  getSelectedActivity(): SalesActivity | null {
    const { selectedActivityId } = this.state.getSnapshot()
    return selectedActivityId ? this.getActivity(selectedActivityId) : null
  }

  getEventLog(): SalesActivityLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Apply the workspace filters, newest-scheduled first. */
  filterActivities(filter: SalesActivityFilter): SalesActivity[] {
    return this.listActivities()
      .filter((a) => filter.fcId === 'all' || a.fcId === filter.fcId)
      .filter((a) => filter.team === 'all' || a.team === filter.team)
      .filter((a) => filter.type === 'all' || a.type === filter.type)
      .filter((a) => filter.status === 'all' || a.status === filter.status)
      .filter((a) => filter.priority === 'all' || a.priority === filter.priority)
  }

  /** Activities linked to a customer, newest-scheduled first (Customer WS). */
  listByCustomer(customerId: string): SalesActivity[] {
    return this.listActivities()
      .filter((a) => a.customerId === customerId)
      .sort((a, b) => (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? 1 : -1)
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- rollups -------------------------------------------------------------

  /** Organization-wide activity summary. */
  getSummary(): SalesActivitySummary {
    const activities = this.listActivities()
    const count = (predicate: (a: SalesActivity) => boolean): number =>
      activities.filter(predicate).length
    const completed = count((a) => a.status === 'completed')
    return {
      total: activities.length,
      today: count((a) => isToday(a.scheduledAt)),
      planned: count((a) => a.status === 'planned'),
      inProgress: count((a) => a.status === 'in-progress'),
      completed,
      delayed: count((a) => a.status === 'delayed'),
      noShow: count((a) => a.status === 'no-show'),
      cancelled: count((a) => a.status === 'cancelled'),
      followUpNeeded: count(needsFollowUp),
      closingPipeline: count((a) => a.type === 'closing' && isOpen(a)),
      overdueFollowUp: count(isOverdue),
      apToday: count((a) => a.type === 'AP' && isToday(a.scheduledAt)),
      completionRate: rate(completed, activities.length)
    }
  }

  /** Per-FC activity ranking, most completed first (FC OS integration). */
  getFcActivityRanking(): FcActivityRank[] {
    const byFc = new Map<string, SalesActivity[]>()
    for (const activity of this.listActivities()) {
      const list = byFc.get(activity.fcId) ?? []
      list.push(activity)
      byFc.set(activity.fcId, list)
    }
    const ranks: FcActivityRank[] = []
    for (const [fcId, list] of byFc) {
      const completed = list.filter((a) => a.status === 'completed').length
      ranks.push({
        fcId,
        fcName: list[0].fcName,
        team: list[0].team,
        total: list.length,
        today: list.filter((a) => isToday(a.scheduledAt)).length,
        completed,
        delayed: list.filter((a) => a.status === 'delayed').length,
        noShow: list.filter((a) => a.status === 'no-show').length,
        completionRate: rate(completed, list.length)
      })
    }
    return ranks.sort((a, b) => b.completed - a.completed || b.total - a.total)
  }

  /** Per-team activity summary, best completion first (FC OS integration). */
  getTeamActivitySummary(): TeamActivitySummary[] {
    const byTeam = new Map<string, SalesActivity[]>()
    for (const activity of this.listActivities()) {
      const list = byTeam.get(activity.team) ?? []
      list.push(activity)
      byTeam.set(activity.team, list)
    }
    const summaries: TeamActivitySummary[] = []
    for (const [team, list] of byTeam) {
      const completed = list.filter((a) => a.status === 'completed').length
      summaries.push({
        team,
        total: list.length,
        today: list.filter((a) => isToday(a.scheduledAt)).length,
        completed,
        completionRate: rate(completed, list.length)
      })
    }
    return summaries.sort((a, b) => b.completionRate - a.completionRate)
  }

  /** Compact per-customer activity rollup (Customer Workspace integration). */
  getCustomerActivitySummary(customerId: string): CustomerActivitySummary {
    const list = this.listByCustomer(customerId)
    const completed = list.filter((a) => a.status === 'completed')
    const upcoming = list
      .filter((a) => isOpen(a) && a.scheduledAt)
      .sort((a, b) => (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1)
    return {
      customerId,
      total: list.length,
      openCount: list.filter(isOpen).length,
      followUpNeeded: list.filter(needsFollowUp).length,
      lastActivity: completed[0] ?? null,
      nextActivity: upcoming[0] ?? null
    }
  }

  // --- selection -----------------------------------------------------------

  selectActivity(activityId: string | null): SalesActivityOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (activityId && !snapshot.activities.some((a) => a.activityId === activityId)) {
      return { success: false, error: 'activity not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedActivityId: activityId })
    this.events.emit('selection:changed', activityId)
    this.events.emit('snapshot:updated')
    return { success: true, data: activityId }
  }

  // --- create --------------------------------------------------------------

  createActivity(input: NewActivityInput): SalesActivityOperationResult<SalesActivity> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'title is empty' }
    const fc = fcRepository.getMember(input.fcId)
    if (!fc) return { success: false, error: 'FC not found' }
    const customer = input.customerId ? customerRepository.getCustomer(input.customerId) : null
    const now = new Date().toISOString()
    const activity: SalesActivity = {
      activityId: this.nextId('act'),
      fcId: fc.fcId,
      fcName: fc.name,
      customerId: customer?.customerId ?? null,
      customerName: customer?.name ?? null,
      team: fc.team,
      type: input.type,
      status: 'planned',
      priority: input.priority ?? 'P2',
      title,
      description: (input.description ?? '').trim(),
      scheduledAt: input.scheduledAt ?? now,
      completedAt: null,
      result: '',
      nextAction: (input.nextAction ?? '').trim(),
      nextActionAt: null,
      memo: '',
      location: (input.location ?? '').trim(),
      relatedConsultationStage: customer?.consultationStage ?? null,
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, activities: [activity, ...snapshot.activities] },
        'created',
        `새 활동: ${fc.name} · ${title}`
      )
    )
    return { success: true, data: activity }
  }

  // --- shared mutation -----------------------------------------------------

  private updateActivity(
    activityId: string,
    mutate: (activity: SalesActivity) => SalesActivity,
    type: SalesActivityLogType,
    message: (activity: SalesActivity) => string
  ): SalesActivityOperationResult<SalesActivity> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.activities.findIndex((a) => a.activityId === activityId)
    if (index === -1) return { success: false, error: 'activity not found' }
    const next: SalesActivity = {
      ...mutate(snapshot.activities[index]),
      activityId,
      updatedAt: new Date().toISOString()
    }
    const activities = [...snapshot.activities]
    activities[index] = next
    this.commit(this.withLog({ ...snapshot, activities }, type, message(next)))
    this.events.emit('activity:updated', next)
    return { success: true, data: next }
  }

  // --- status transitions --------------------------------------------------

  markInProgress(activityId: string): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, status: 'in-progress' }),
      'in-progress',
      (a) => `${a.title} 진행중`
    )
  }

  /**
   * Complete an activity. Records completedAt and, when it is customer-linked
   * and was not already completed, appends to that customer's activity timeline
   * through the Customer Workspace public API (simple call, no redesign).
   */
  markCompleted(activityId: string, result = ''): SalesActivityOperationResult<SalesActivity> {
    const before = this.getActivity(activityId)
    const wasCompleted = before?.status === 'completed'
    const now = new Date().toISOString()
    const outcome = this.updateActivity(
      activityId,
      (a) => ({
        ...a,
        status: 'completed',
        completedAt: now,
        result: result.trim() || a.result || '완료'
      }),
      'completed',
      (a) => `${a.title} 완료`
    )
    if (outcome.success && outcome.data && !wasCompleted && outcome.data.customerId) {
      const a = outcome.data
      customerRepository.addActivity(a.customerId as string, a.type, `${a.title}${a.result ? ` — ${a.result}` : ''}`)
    }
    return outcome
  }

  markDelayed(activityId: string): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, status: 'delayed' }),
      'delayed',
      (a) => `${a.title} 연기`
    )
  }

  markCancelled(activityId: string): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, status: 'cancelled' }),
      'cancelled',
      (a) => `${a.title} 취소`
    )
  }

  markNoShow(activityId: string): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, status: 'no-show' }),
      'no-show',
      (a) => `${a.title} 노쇼`
    )
  }

  markNeedsFollowUp(activityId: string): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, status: 'needs-follow-up' }),
      'next-action-updated',
      (a) => `${a.title} 후속관리 필요`
    )
  }

  // --- edits ---------------------------------------------------------------

  addMemo(activityId: string, text: string): SalesActivityOperationResult<SalesActivity> {
    const body = text.trim()
    if (!body) return { success: false, error: 'memo is empty' }
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, memo: a.memo ? `${a.memo}\n- ${body}` : `- ${body}` }),
      'memo-added',
      (a) => `${a.title} 메모 추가`
    )
  }

  updateNextAction(
    activityId: string,
    nextAction: string,
    nextActionAt: string | null = null
  ): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, nextAction: nextAction.trim(), nextActionAt: nextActionAt ?? a.nextActionAt }),
      'next-action-updated',
      (a) => `${a.title} 다음 액션 업데이트`
    )
  }

  reschedule(activityId: string, scheduledAt: string): SalesActivityOperationResult<SalesActivity> {
    const value = scheduledAt.trim()
    if (!value) return { success: false, error: 'date is empty' }
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, scheduledAt: value, status: a.status === 'delayed' ? 'planned' : a.status }),
      'rescheduled',
      (a) => `${a.title} 일정 변경`
    )
  }

  assignToFc(activityId: string, fcId: string): SalesActivityOperationResult<SalesActivity> {
    const fc = fcRepository.getMember(fcId)
    if (!fc) return { success: false, error: 'FC not found' }
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, fcId: fc.fcId, fcName: fc.name, team: fc.team }),
      'fc-assigned',
      (a) => `${a.title} → ${fc.name} 배정`
    )
  }

  changePriority(activityId: string, priority: ActivityPriority): SalesActivityOperationResult<SalesActivity> {
    return this.updateActivity(
      activityId,
      (a) => ({ ...a, priority }),
      'priority-changed',
      (a) => `${a.title} 우선순위 → ${priority}`
    )
  }

  /**
   * Push this activity's related consultation stage onto the linked customer via
   * the Customer Workspace public API (Customer Workspace integration).
   */
  applyConsultationStage(activityId: string): SalesActivityOperationResult<SalesActivity> {
    const activity = this.getActivity(activityId)
    if (!activity) return { success: false, error: 'activity not found' }
    if (!activity.customerId || !activity.relatedConsultationStage) {
      return { success: false, error: 'no linked customer stage' }
    }
    customerRepository.updateConsultationStage(activity.customerId, activity.relatedConsultationStage)
    return this.updateActivity(
      activityId,
      (a) => ({ ...a }),
      'stage-synced',
      (a) => `${a.customerName ?? '고객'} 상담단계 반영: ${a.relatedConsultationStage}`
    )
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical Sales Activity questions locally. This is the
   * seam a future Jarvis intent will call — it returns a ready-to-speak Korean
   * summary built from local data, with no external AI call. UI wiring is left
   * for a later sprint.
   */
  answerJarvisQuery(query: SalesActivityJarvisQuery): string {
    switch (query) {
      case '오늘 영업활동': {
        const s = this.getSummary()
        return `오늘 영업활동 ${s.today}건 · 완료 ${s.completed}, 진행중 ${s.inProgress}, 연기/노쇼 ${s.delayed + s.noShow}`
      }
      case 'FC별 활동 현황':
        return `FC별 활동 현황 · ${this.getFcActivityRanking()
          .map((r) => `${r.fcName} ${r.completed}/${r.total}`)
          .join(', ')}`
      case '미완료 활동': {
        const open = this.listActivities().filter(isOpen)
        return open.length === 0 ? '미완료 활동이 없습니다.' : `미완료 활동 ${open.length}건`
      }
      case '클로징 예정 고객': {
        const closing = this.listActivities().filter((a) => a.type === 'closing' && isOpen(a))
        return closing.length === 0
          ? '클로징 예정 고객이 없습니다.'
          : `클로징 예정 ${closing.length}건 · ${closing.map((a) => a.customerName ?? a.title).join(', ')}`
      }
      case '오늘 AP 현황': {
        const s = this.getSummary()
        return `오늘 AP ${s.apToday}건`
      }
      case '기고객 관리 대상': {
        const care = this.listActivities().filter(
          (a) => (a.type === 'existing-customer-care' || a.type === 'after-care') && isOpen(a)
        )
        return care.length === 0
          ? '기고객 관리 대상이 없습니다.'
          : `기고객 관리 대상 ${care.length}건 · ${care.map((a) => a.customerName ?? a.title).join(', ')}`
      }
      case '팀별 활동 순위':
        return `팀별 활동 순위 · ${this.getTeamActivitySummary()
          .map((t) => `${t.team} ${t.completionRate}%`)
          .join(', ')}`
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
        'Sales Activity Workspace foundation created — sales activity workflow ready for future Jarvis reporting'
      )
    )
    devOsRepository.recordEvent(
      'Sales Activity Workspace foundation created — next recommended action: build Schedule Workspace'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Sales Activity Workspace back to the seed. */
  resetDemoState(): SalesActivityOperationResult<SalesActivitySnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Sales Activity Workspace demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const salesActivityRepository = new SalesActivityRepository()
