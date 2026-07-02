/**
 * FC Operating System — organization & field-consultant types.
 *
 * SJ Invest is an insurance sales organization. The FC OS is the first module
 * that models the *real* organization SJ OS will run: FCs (financial
 * consultants), team leaders and managers, their attendance, daily activity,
 * schedules and monthly production. These types are the shape of that state,
 * persisted locally alongside the DevOS / PM / CTO / Approval / QA / Release /
 * DevOps memory (no external API, no database).
 *
 * This is a self-contained local service in the same repository + state +
 * event-bus + persistence style as the other SJ OS modules. All data is mock
 * and local; it holds no real personal or sensitive information.
 */

/** Employment / lifecycle status of an FC. */
export type FcStatus = 'active' | 'inactive' | 'onboarding' | 'training' | 'suspended'

/** Today's attendance state for an FC. */
export type FcAttendanceStatus =
  | 'not-checked-in'
  | 'checked-in'
  | 'late'
  | 'outside'
  | 'absent'
  | 'checked-out'

/** Where a member sits in the organization hierarchy. */
export type FcRole = 'FC' | 'Team Leader' | 'Branch Manager' | 'Regional Manager' | 'CEO'

/** A single member of the SJ Invest field organization. */
export interface FcMember {
  fcId: string
  name: string
  role: FcRole
  /** Team / branch the member belongs to, e.g. "강남 1팀". */
  team: string
  /** Korean insurance grade, e.g. "수석플래너", "팀장". */
  rank: string
  status: FcStatus
  attendanceStatus: FcAttendanceStatus
  todayScheduleCount: number
  todayActivityCount: number
  /** This month's collected premium, in KRW. */
  monthlyPremium: number
  monthlyContractCount: number
  /** This month's premium target, in KRW. */
  targetPremium: number
  /** 0–100, derived from monthlyPremium / targetPremium. */
  achievementRate: number
  phone: string
  joinedAt: string
  updatedAt: string
}

/** Kinds of events recorded in the persisted FC OS event log. */
export type FcLogType =
  | 'checked-in'
  | 'checked-out'
  | 'marked-late'
  | 'marked-absent'
  | 'premium-updated'
  | 'activity-updated'
  | 'team-assigned'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted FC OS event log. */
export interface FcLogEntry {
  id: string
  type: FcLogType
  message: string
  createdAt: string
}

/** The full persisted FC OS snapshot. */
export interface FcSnapshot {
  members: FcMember[]
  /** Newest-first log of meaningful FC OS changes. */
  eventLog: FcLogEntry[]
}

/** Organization-wide rollup for the FC OS home and CEO Dashboard. */
export interface FcSummary {
  totalFc: number
  activeFc: number
  checkedIn: number
  late: number
  absent: number
  outside: number
  onboarding: number
  todayScheduleTotal: number
  todayActivityTotal: number
  monthlyPremiumTotal: number
  targetPremiumTotal: number
  monthlyContractTotal: number
  /** 0–100 org-wide, from monthlyPremiumTotal / targetPremiumTotal. */
  achievementRate: number
  /** FCs with zero activity logged today. */
  inactiveFcCount: number
}

/** Per-team performance rollup. */
export interface TeamSummary {
  team: string
  memberCount: number
  checkedIn: number
  monthlyPremium: number
  targetPremium: number
  achievementRate: number
  activityTotal: number
}

/** A suggested next action surfaced on the FC OS home. */
export interface FcPriorityAction {
  id: string
  label: string
  detail: string
  tone: 'info' | 'warning' | 'success'
}
