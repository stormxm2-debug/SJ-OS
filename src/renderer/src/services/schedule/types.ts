/**
 * Schedule Workspace — SJ Invest scheduling and calendar types.
 *
 * The Schedule Workspace is the shared calendar of the SJ Invest operating
 * heartbeat: FC work schedules, customer follow-ups, meetings and appointments,
 * viewed as today / overdue / upcoming actions on a calendar-style board. Each
 * item links to an FC (FC OS) and, when relevant, a customer (Customer
 * Workspace). These types are the shape of that state, persisted locally
 * alongside the FC OS / Customer / Sales Activity memory (no external API, no
 * database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the Sales Activity Workspace. All data is
 * mock and local; it holds no real personal or sensitive information.
 */

/** What kind of schedule item this is. */
export type ScheduleKind =
  | 'fc-schedule'
  | 'customer-follow-up'
  | 'meeting'
  | 'appointment'

/** Where the schedule item stands. */
export type ScheduleStatus =
  | 'scheduled'
  | 'confirmed'
  | 'in-progress'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'missed'

/** Priority ladder, shared across SJ OS. */
export type SchedulePriority = 'P0' | 'P1' | 'P2' | 'P3'

/** A single item on the shared SJ Invest schedule / calendar. */
export interface ScheduleItem {
  scheduleId: string
  kind: ScheduleKind
  status: ScheduleStatus
  priority: SchedulePriority
  title: string
  description: string
  fcId: string
  fcName: string
  team: string
  customerId: string | null
  customerName: string | null
  /** ISO datetime the item is scheduled to start. */
  startAt: string
  /** ISO datetime the item is scheduled to end (null = open-ended). */
  endAt: string | null
  location: string
  /** ISO datetime the item was completed (null = not completed). */
  completedAt: string | null
  result: string
  nextAction: string
  memo: string
  createdAt: string
  updatedAt: string
}

/** Kinds of events recorded in the persisted Schedule event log. */
export type ScheduleLogType =
  | 'created'
  | 'confirmed'
  | 'in-progress'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'missed'
  | 'memo-added'
  | 'next-action-updated'
  | 'fc-assigned'
  | 'priority-changed'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Schedule event log. */
export interface ScheduleLogEntry {
  id: string
  type: ScheduleLogType
  message: string
  createdAt: string
}

/** The full persisted Schedule Workspace snapshot. */
export interface ScheduleSnapshot {
  items: ScheduleItem[]
  /** Id of the item currently open in the detail panel (null = none). */
  selectedScheduleId: string | null
  /** Newest-first log of meaningful Schedule changes. */
  eventLog: ScheduleLogEntry[]
}

/** Organization-wide schedule rollup. */
export interface ScheduleSummary {
  total: number
  today: number
  upcoming: number
  overdue: number
  completed: number
  cancelled: number
  missed: number
  meetings: number
  appointments: number
  followUps: number
  completionRate: number
}

/** A single calendar day column with its schedule items. */
export interface ScheduleDay {
  /** Local calendar day key, YYYY-MM-DD. */
  dateKey: string
  /** Short weekday label, e.g. 목. */
  weekdayLabel: string
  isToday: boolean
  items: ScheduleItem[]
}

/** Per-FC schedule rollup (FC OS integration). */
export interface FcScheduleSummary {
  fcId: string
  fcName: string
  team: string
  total: number
  today: number
  upcoming: number
  overdue: number
  completed: number
  completionRate: number
}

/** Filter selection for the schedule list. */
export interface ScheduleFilter {
  fcId: string | 'all'
  team: string | 'all'
  kind: ScheduleKind | 'all'
  status: ScheduleStatus | 'all'
  priority: SchedulePriority | 'all'
}
