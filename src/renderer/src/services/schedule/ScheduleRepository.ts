import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import { ScheduleEvents, type ScheduleEventName } from './ScheduleEvents'
import { ScheduleState } from './ScheduleState'
import { scheduleSeed } from './seed'
import type {
  FcScheduleSummary,
  ScheduleDay,
  ScheduleFilter,
  ScheduleItem,
  ScheduleKind,
  ScheduleLogEntry,
  ScheduleLogType,
  SchedulePriority,
  ScheduleSnapshot,
  ScheduleStatus,
  ScheduleSummary
} from './types'

export interface ScheduleOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Fields a caller supplies to create a new schedule item. */
export interface NewScheduleInput {
  fcId: string
  kind: ScheduleKind
  title: string
  startAt: string
  description?: string
  priority?: SchedulePriority
  customerId?: string | null
  endAt?: string | null
  location?: string
  nextAction?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

/** How many days the calendar-style board spans, starting today. */
const BOARD_DAYS = 7

/** Canonical Jarvis query keys the Schedule Workspace answers locally. */
export type ScheduleJarvisQuery =
  | '오늘 일정'
  | '지난 일정'
  | '다가오는 일정'
  | '오늘 미팅'
  | 'FC별 일정'
  | '고객 후속 일정'

const TERMINAL_STATUSES = new Set<ScheduleStatus>(['completed', 'cancelled'])

function cloneSeed(): ScheduleSnapshot {
  return JSON.parse(JSON.stringify(scheduleSeed)) as ScheduleSnapshot
}

/** Local YYYY-MM-DD key for an ISO datetime. */
export function dayKey(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** True when an ISO date falls on the current calendar day (local time). */
export function isToday(iso: string | null): boolean {
  if (!iso) return false
  return dayKey(iso) === dayKey(new Date().toISOString())
}

/** An item is still open when it hasn't reached a terminal status. */
export function isOpen(item: ScheduleItem): boolean {
  return !TERMINAL_STATUSES.has(item.status)
}

/** True when an open item's start time is in the past (and not today). */
export function isOverdue(item: ScheduleItem): boolean {
  if (!isOpen(item)) return false
  if (item.status === 'missed') return true
  if (isToday(item.startAt)) return false
  const start = new Date(item.startAt).getTime()
  return !Number.isNaN(start) && start < Date.now()
}

/** True when an open item starts after today. */
export function isUpcoming(item: ScheduleItem): boolean {
  if (!isOpen(item)) return false
  if (isToday(item.startAt)) return false
  const start = new Date(item.startAt).getTime()
  return !Number.isNaN(start) && start > Date.now()
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/**
 * Repository over the Schedule Workspace. Same shape as SalesActivityRepository
 * / CustomerRepository: a state holder + event bus, mutations return a result
 * and persist through ScheduleState. All schedule business logic lives here, not
 * in React components. Meaningful changes also append to the persisted event
 * log.
 *
 * Actions are safe and local only — no external API, no database. Item creation
 * and assignment reuse the FC OS roster and Customer Workspace through their
 * public APIs; completing a customer-linked item appends to that customer's
 * timeline. On first initialisation it records a single, non-intrusive note into
 * the Development OS event log (Live Company feed); it never rewrites the active
 * DevOS session or next action.
 */
export class ScheduleRepository {
  private seq = 0

  constructor(
    private readonly state = new ScheduleState(),
    private readonly events = new ScheduleEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): ScheduleSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: ScheduleEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: ScheduleLogType, message: string): ScheduleLogEntry {
    return { id: this.nextId('schevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: ScheduleSnapshot,
    type: ScheduleLogType,
    message: string
  ): ScheduleSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: ScheduleSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listItems(): ScheduleItem[] {
    return this.state.getSnapshot().items
  }

  getItem(scheduleId: string): ScheduleItem | null {
    return this.state.getSnapshot().items.find((i) => i.scheduleId === scheduleId) ?? null
  }

  getSelectedItem(): ScheduleItem | null {
    const { selectedScheduleId } = this.state.getSnapshot()
    return selectedScheduleId ? this.getItem(selectedScheduleId) : null
  }

  getEventLog(): ScheduleLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Apply the workspace filters, earliest-start first. */
  filterItems(filter: ScheduleFilter): ScheduleItem[] {
    return this.listItems()
      .filter((i) => filter.fcId === 'all' || i.fcId === filter.fcId)
      .filter((i) => filter.team === 'all' || i.team === filter.team)
      .filter((i) => filter.kind === 'all' || i.kind === filter.kind)
      .filter((i) => filter.status === 'all' || i.status === filter.status)
      .filter((i) => filter.priority === 'all' || i.priority === filter.priority)
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
  }

  /** Items linked to a customer, earliest-start first (Customer Workspace). */
  listByCustomer(customerId: string): ScheduleItem[] {
    return this.listItems()
      .filter((i) => i.customerId === customerId)
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
  }

  /** Today's items, earliest-start first. */
  getToday(): ScheduleItem[] {
    return this.listItems()
      .filter((i) => isToday(i.startAt))
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
  }

  /** Overdue open items, earliest-start first. */
  getOverdue(): ScheduleItem[] {
    return this.listItems()
      .filter(isOverdue)
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
  }

  /** Upcoming open items, earliest-start first. */
  getUpcoming(): ScheduleItem[] {
    return this.listItems()
      .filter(isUpcoming)
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- rollups -------------------------------------------------------------

  /** Organization-wide schedule summary. */
  getSummary(): ScheduleSummary {
    const items = this.listItems()
    const count = (predicate: (i: ScheduleItem) => boolean): number =>
      items.filter(predicate).length
    const completed = count((i) => i.status === 'completed')
    return {
      total: items.length,
      today: count((i) => isToday(i.startAt)),
      upcoming: count(isUpcoming),
      overdue: count(isOverdue),
      completed,
      cancelled: count((i) => i.status === 'cancelled'),
      missed: count((i) => i.status === 'missed'),
      meetings: count((i) => i.kind === 'meeting'),
      appointments: count((i) => i.kind === 'appointment'),
      followUps: count((i) => i.kind === 'customer-follow-up'),
      completionRate: rate(completed, items.length)
    }
  }

  /**
   * Calendar-style board: BOARD_DAYS day columns starting today, each with its
   * items sorted by start time.
   */
  getBoard(): ScheduleDay[] {
    const items = this.listItems()
    const todayKey = dayKey(new Date().toISOString())
    const base = new Date(`${todayKey}T00:00:00`)
    const days: ScheduleDay[] = []
    for (let offset = 0; offset < BOARD_DAYS; offset += 1) {
      const date = new Date(base)
      date.setDate(base.getDate() + offset)
      const key = dayKey(date.toISOString())
      days.push({
        dateKey: key,
        weekdayLabel: WEEKDAYS[date.getDay()],
        isToday: offset === 0,
        items: items
          .filter((i) => dayKey(i.startAt) === key)
          .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
      })
    }
    return days
  }

  /** Per-FC schedule ranking, most today-work first (FC OS integration). */
  getFcScheduleSummary(): FcScheduleSummary[] {
    const byFc = new Map<string, ScheduleItem[]>()
    for (const item of this.listItems()) {
      const list = byFc.get(item.fcId) ?? []
      list.push(item)
      byFc.set(item.fcId, list)
    }
    const summaries: FcScheduleSummary[] = []
    for (const [fcId, list] of byFc) {
      const completed = list.filter((i) => i.status === 'completed').length
      summaries.push({
        fcId,
        fcName: list[0].fcName,
        team: list[0].team,
        total: list.length,
        today: list.filter((i) => isToday(i.startAt)).length,
        upcoming: list.filter(isUpcoming).length,
        overdue: list.filter(isOverdue).length,
        completed,
        completionRate: rate(completed, list.length)
      })
    }
    return summaries.sort((a, b) => b.today - a.today || b.total - a.total)
  }

  // --- selection -----------------------------------------------------------

  selectItem(scheduleId: string | null): ScheduleOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (scheduleId && !snapshot.items.some((i) => i.scheduleId === scheduleId)) {
      return { success: false, error: 'schedule item not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedScheduleId: scheduleId })
    this.events.emit('selection:changed', scheduleId)
    this.events.emit('snapshot:updated')
    return { success: true, data: scheduleId }
  }

  // --- create --------------------------------------------------------------

  createItem(input: NewScheduleInput): ScheduleOperationResult<ScheduleItem> {
    const title = input.title.trim()
    if (!title) return { success: false, error: 'title is empty' }
    const start = input.startAt.trim()
    if (!start) return { success: false, error: 'start time is empty' }
    const fc = fcRepository.getMember(input.fcId)
    if (!fc) return { success: false, error: 'FC not found' }
    const customer = input.customerId ? customerRepository.getCustomer(input.customerId) : null
    const now = new Date().toISOString()
    const item: ScheduleItem = {
      scheduleId: this.nextId('sch'),
      kind: input.kind,
      status: 'scheduled',
      priority: input.priority ?? 'P2',
      title,
      description: (input.description ?? '').trim(),
      fcId: fc.fcId,
      fcName: fc.name,
      team: fc.team,
      customerId: customer?.customerId ?? null,
      customerName: customer?.name ?? null,
      startAt: start,
      endAt: input.endAt ?? null,
      location: (input.location ?? '').trim(),
      completedAt: null,
      result: '',
      nextAction: (input.nextAction ?? '').trim(),
      memo: '',
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, items: [item, ...snapshot.items] },
        'created',
        `새 일정: ${fc.name} · ${title}`
      )
    )
    return { success: true, data: item }
  }

  // --- shared mutation -----------------------------------------------------

  private updateItem(
    scheduleId: string,
    mutate: (item: ScheduleItem) => ScheduleItem,
    type: ScheduleLogType,
    message: (item: ScheduleItem) => string
  ): ScheduleOperationResult<ScheduleItem> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.items.findIndex((i) => i.scheduleId === scheduleId)
    if (index === -1) return { success: false, error: 'schedule item not found' }
    const next: ScheduleItem = {
      ...mutate(snapshot.items[index]),
      scheduleId,
      updatedAt: new Date().toISOString()
    }
    const items = [...snapshot.items]
    items[index] = next
    this.commit(this.withLog({ ...snapshot, items }, type, message(next)))
    this.events.emit('item:updated', next)
    return { success: true, data: next }
  }

  // --- status transitions --------------------------------------------------

  confirmItem(scheduleId: string): ScheduleOperationResult<ScheduleItem> {
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, status: 'confirmed' }),
      'confirmed',
      (i) => `${i.title} 확정`
    )
  }

  markInProgress(scheduleId: string): ScheduleOperationResult<ScheduleItem> {
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, status: 'in-progress' }),
      'in-progress',
      (i) => `${i.title} 진행중`
    )
  }

  /**
   * Complete a schedule item. Records completedAt and, when it is
   * customer-linked and was not already completed, appends to that customer's
   * activity timeline through the Customer Workspace public API.
   */
  markCompleted(scheduleId: string, result = ''): ScheduleOperationResult<ScheduleItem> {
    const before = this.getItem(scheduleId)
    const wasCompleted = before?.status === 'completed'
    const now = new Date().toISOString()
    const outcome = this.updateItem(
      scheduleId,
      (i) => ({
        ...i,
        status: 'completed',
        completedAt: now,
        result: result.trim() || i.result || '완료'
      }),
      'completed',
      (i) => `${i.title} 완료`
    )
    if (outcome.success && outcome.data && !wasCompleted && outcome.data.customerId) {
      const i = outcome.data
      customerRepository.addActivity(
        i.customerId as string,
        i.kind,
        `${i.title}${i.result ? ` — ${i.result}` : ''}`
      )
    }
    return outcome
  }

  markMissed(scheduleId: string): ScheduleOperationResult<ScheduleItem> {
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, status: 'missed' }),
      'missed',
      (i) => `${i.title} 미이행`
    )
  }

  markCancelled(scheduleId: string): ScheduleOperationResult<ScheduleItem> {
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, status: 'cancelled' }),
      'cancelled',
      (i) => `${i.title} 취소`
    )
  }

  // --- edits ---------------------------------------------------------------

  reschedule(
    scheduleId: string,
    startAt: string,
    endAt: string | null = null
  ): ScheduleOperationResult<ScheduleItem> {
    const value = startAt.trim()
    if (!value) return { success: false, error: 'date is empty' }
    return this.updateItem(
      scheduleId,
      (i) => ({
        ...i,
        startAt: value,
        endAt: endAt ?? i.endAt,
        status: i.status === 'missed' || i.status === 'cancelled' ? 'scheduled' : 'rescheduled'
      }),
      'rescheduled',
      (i) => `${i.title} 일정 변경`
    )
  }

  addMemo(scheduleId: string, text: string): ScheduleOperationResult<ScheduleItem> {
    const body = text.trim()
    if (!body) return { success: false, error: 'memo is empty' }
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, memo: i.memo ? `${i.memo}\n- ${body}` : `- ${body}` }),
      'memo-added',
      (i) => `${i.title} 메모 추가`
    )
  }

  updateNextAction(scheduleId: string, nextAction: string): ScheduleOperationResult<ScheduleItem> {
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, nextAction: nextAction.trim() }),
      'next-action-updated',
      (i) => `${i.title} 다음 액션 업데이트`
    )
  }

  assignToFc(scheduleId: string, fcId: string): ScheduleOperationResult<ScheduleItem> {
    const fc = fcRepository.getMember(fcId)
    if (!fc) return { success: false, error: 'FC not found' }
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, fcId: fc.fcId, fcName: fc.name, team: fc.team }),
      'fc-assigned',
      (i) => `${i.title} → ${fc.name} 배정`
    )
  }

  changePriority(
    scheduleId: string,
    priority: SchedulePriority
  ): ScheduleOperationResult<ScheduleItem> {
    return this.updateItem(
      scheduleId,
      (i) => ({ ...i, priority }),
      'priority-changed',
      (i) => `${i.title} 우선순위 → ${priority}`
    )
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical Schedule questions locally. This is the seam a
   * future Jarvis intent will call — it returns a ready-to-speak Korean summary
   * built from local data, with no external AI call. UI wiring is left for a
   * later sprint.
   */
  answerJarvisQuery(query: ScheduleJarvisQuery): string {
    switch (query) {
      case '오늘 일정': {
        const s = this.getSummary()
        return `오늘 일정 ${s.today}건 · 미팅 ${this.getToday().filter((i) => i.kind === 'meeting').length}, 약속 ${this.getToday().filter((i) => i.kind === 'appointment').length}`
      }
      case '지난 일정': {
        const overdue = this.getOverdue()
        return overdue.length === 0
          ? '지난(연체) 일정이 없습니다.'
          : `연체 일정 ${overdue.length}건 · ${overdue.map((i) => i.title).join(', ')}`
      }
      case '다가오는 일정': {
        const upcoming = this.getUpcoming()
        return upcoming.length === 0
          ? '다가오는 일정이 없습니다.'
          : `다가오는 일정 ${upcoming.length}건 · ${upcoming
              .slice(0, 5)
              .map((i) => i.title)
              .join(', ')}`
      }
      case '오늘 미팅': {
        const meetings = this.getToday().filter((i) => i.kind === 'meeting' || i.kind === 'appointment')
        return meetings.length === 0
          ? '오늘 예정된 미팅이 없습니다.'
          : `오늘 미팅/약속 ${meetings.length}건 · ${meetings.map((i) => i.title).join(', ')}`
      }
      case 'FC별 일정':
        return `FC별 일정 · ${this.getFcScheduleSummary()
          .map((s) => `${s.fcName} 오늘 ${s.today}/${s.total}`)
          .join(', ')}`
      case '고객 후속 일정': {
        const follow = this.listItems().filter((i) => i.kind === 'customer-follow-up' && isOpen(i))
        return follow.length === 0
          ? '예정된 고객 후속 일정이 없습니다.'
          : `고객 후속 일정 ${follow.length}건 · ${follow.map((i) => i.customerName ?? i.title).join(', ')}`
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
        'Schedule Workspace foundation created — shared FC/customer calendar ready for future Jarvis reporting'
      )
    )
    devOsRepository.recordEvent(
      'Schedule Workspace foundation created — next recommended action: build Performance Workspace'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Schedule Workspace back to the seed. */
  resetDemoState(): ScheduleOperationResult<ScheduleSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Schedule Workspace demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const scheduleRepository = new ScheduleRepository()
