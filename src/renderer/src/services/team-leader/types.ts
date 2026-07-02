/**
 * Team Leader Workspace — SJ Invest team-leadership types.
 *
 * The Team Leader Workspace is the leadership cockpit of the SJ Invest operating
 * heartbeat: for a chosen team it shows the assigned FCs, their attendance,
 * today's activity, customer follow-ups and monthly performance, alongside the
 * leader's own coaching notes, blockers and next actions. The team roster,
 * attendance, activity and performance are derived live from the FC OS roster;
 * customer follow-ups are derived from the Schedule Workspace; coaching notes,
 * blockers and next actions are seeded and persisted locally. These types are
 * the shape of that state, persisted alongside the FC OS / Customer / Sales
 * Activity / Schedule / Performance memory (no external API, no database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the Performance Workspace. All data is mock
 * and local; it holds no real personal or sensitive information.
 */

/** Severity of a team blocker. */
export type BlockerSeverity = 'low' | 'medium' | 'high'

/** Where a team blocker stands. */
export type BlockerStatus = 'open' | 'in-progress' | 'resolved'

/** A coaching note the team leader records about a team or a specific FC. */
export interface CoachingNote {
  id: string
  team: string
  /** Target FC, or null for a team-wide note. */
  fcId: string | null
  fcName: string | null
  author: string
  text: string
  createdAt: string
}

/** A blocker impeding a team or FC that the leader is working to clear. */
export interface Blocker {
  id: string
  team: string
  fcId: string | null
  fcName: string | null
  title: string
  detail: string
  severity: BlockerSeverity
  status: BlockerStatus
  createdAt: string
  updatedAt: string
}

/** A leader's next action for a team or FC. */
export interface LeaderNextAction {
  id: string
  team: string
  fcId: string | null
  fcName: string | null
  label: string
  due: string | null
  done: boolean
  createdAt: string
}

/** Kinds of events recorded in the persisted Team Leader event log. */
export type TeamLeaderLogType =
  | 'team-selected'
  | 'note-added'
  | 'blocker-added'
  | 'blocker-updated'
  | 'action-added'
  | 'action-toggled'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Team Leader event log. */
export interface TeamLeaderLogEntry {
  id: string
  type: TeamLeaderLogType
  message: string
  createdAt: string
}

/** The full persisted Team Leader Workspace snapshot (leader-owned data). */
export interface TeamLeaderSnapshot {
  /** The team currently in focus (team name), or null to pick the first. */
  selectedTeam: string | null
  coachingNotes: CoachingNote[]
  blockers: Blocker[]
  nextActions: LeaderNextAction[]
  eventLog: TeamLeaderLogEntry[]
}

/** A single assigned-FC row in the team view (derived from FC OS). */
export interface TeamMemberRow {
  fcId: string
  name: string
  role: string
  rank: string
  attendanceStatus: string
  todayActivityCount: number
  todayScheduleCount: number
  monthlyPremium: number
  targetPremium: number
  achievementRate: number
  monthlyContractCount: number
}

/** Attendance rollup for a team (derived from FC OS). */
export interface TeamAttendance {
  total: number
  checkedIn: number
  late: number
  absent: number
  outside: number
  notCheckedIn: number
}

/** The full derived view of one team for the leader cockpit. */
export interface TeamLeaderView {
  team: string
  leaderName: string
  fcCount: number
  attendance: TeamAttendance
  todayActivityTotal: number
  todayScheduleTotal: number
  monthlyPremium: number
  targetPremium: number
  contractTotal: number
  achievementRate: number
  /** FCs with zero activity logged today. */
  inactiveCount: number
  members: TeamMemberRow[]
}
