/**
 * Sales Activity Workspace — insurance sales activity types.
 *
 * Sales activity is the daily operating heartbeat of SJ Invest: AP calls, 1차/2차
 * meetings, needs analysis, policy review, proposals, closing, contracts and
 * existing-customer care. The Sales Activity Workspace records, filters,
 * completes and summarises those activities and links them to FCs (FC OS) and
 * customers (Customer Workspace). These types are the shape of that state,
 * persisted locally alongside the FC OS / Customer / DevOS memory (no external
 * API, no database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the Customer Workspace. All data is mock
 * and local; it holds no real personal or sensitive information.
 */

import type { ConsultationStage } from '@renderer/services/customer/types'

/** What kind of sales activity this is. */
export type ActivityType =
  | 'AP'
  | 'first-meeting'
  | 'second-meeting'
  | 'needs-analysis'
  | 'policy-review'
  | 'proposal'
  | 'closing'
  | 'contract'
  | 'referral-request'
  | 'existing-customer-care'
  | 'follow-up'
  | 'after-care'

/** Where the activity stands. */
export type ActivityStatus =
  | 'planned'
  | 'in-progress'
  | 'completed'
  | 'cancelled'
  | 'delayed'
  | 'no-show'
  | 'needs-follow-up'

/** Priority ladder, shared across SJ OS. */
export type ActivityPriority = 'P0' | 'P1' | 'P2' | 'P3'

/** A single sales activity in the SJ Invest operating heartbeat. */
export interface SalesActivity {
  activityId: string
  fcId: string
  fcName: string
  customerId: string | null
  customerName: string | null
  team: string
  type: ActivityType
  status: ActivityStatus
  priority: ActivityPriority
  title: string
  description: string
  scheduledAt: string | null
  completedAt: string | null
  result: string
  nextAction: string
  nextActionAt: string | null
  memo: string
  location: string
  /** The consultation stage this activity advances (from Customer Workspace). */
  relatedConsultationStage: ConsultationStage | null
  createdAt: string
  updatedAt: string
}

/** Kinds of events recorded in the persisted Sales Activity event log. */
export type SalesActivityLogType =
  | 'created'
  | 'in-progress'
  | 'completed'
  | 'delayed'
  | 'cancelled'
  | 'no-show'
  | 'memo-added'
  | 'next-action-updated'
  | 'rescheduled'
  | 'fc-assigned'
  | 'priority-changed'
  | 'stage-synced'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Sales Activity event log. */
export interface SalesActivityLogEntry {
  id: string
  type: SalesActivityLogType
  message: string
  createdAt: string
}

/** The full persisted Sales Activity Workspace snapshot. */
export interface SalesActivitySnapshot {
  activities: SalesActivity[]
  /** Id of the activity currently open in the detail panel (null = none). */
  selectedActivityId: string | null
  /** Newest-first log of meaningful Sales Activity changes. */
  eventLog: SalesActivityLogEntry[]
}

/** Organization-wide sales-activity rollup. */
export interface SalesActivitySummary {
  total: number
  today: number
  planned: number
  inProgress: number
  completed: number
  delayed: number
  noShow: number
  cancelled: number
  followUpNeeded: number
  closingPipeline: number
  overdueFollowUp: number
  apToday: number
  completionRate: number
}

/** Per-FC activity ranking row (FC OS integration). */
export interface FcActivityRank {
  fcId: string
  fcName: string
  team: string
  total: number
  today: number
  completed: number
  delayed: number
  noShow: number
  completionRate: number
}

/** Per-team activity rollup (FC OS integration). */
export interface TeamActivitySummary {
  team: string
  total: number
  today: number
  completed: number
  completionRate: number
}

/** Compact per-customer activity rollup (Customer Workspace integration). */
export interface CustomerActivitySummary {
  customerId: string
  total: number
  openCount: number
  followUpNeeded: number
  lastActivity: SalesActivity | null
  nextActivity: SalesActivity | null
}

/** Filter selection for the activity list. */
export interface SalesActivityFilter {
  fcId: string | 'all'
  team: string | 'all'
  type: ActivityType | 'all'
  status: ActivityStatus | 'all'
  priority: ActivityPriority | 'all'
}
