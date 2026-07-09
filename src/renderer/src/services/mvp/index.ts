import { DEMO_USERS, type UserRole } from '@renderer/navigation/roleAccess'

/**
 * MVP service boundaries. These are clean seams to swap for a real server API later.
 *
 * As of the commercial rollout the sample/demo values were CLEARED to zero/empty so a
 * real organization starts from a clean slate (no fake staff, attendance, customers,
 * performance, or notices). Replace each body with a real server API (REST/RPC) call
 * when wiring live aggregation; keep the signatures stable so the UI does not change.
 */

export interface AttendanceInfo {
  checkedIn: boolean
  checkInTime?: string
  status: '출근' | '미출근' | '외근' | '휴가'
}
export interface CustomerSummary {
  total: number
  pending: number
  todayConsultations: number
}
export interface PerformanceSummary {
  monthlyCount: number
  monthlyPremium: string
  target: string
  achievementRate: number
}
export interface Notice {
  id: string
  title: string
  body: string
  postedAt: string
  pinned?: boolean
}
export interface TeamMemberStatus {
  name: string
  attendance: '출근' | '미출근' | '외근' | '휴가'
  todayConsultations: number
  monthlyCount: number
}

// --- authService -----------------------------------------------------------
export const authService = {
  listDemoUsers: () => DEMO_USERS,
  roleLabel: (role: UserRole): string =>
    ({ owner: '대표', admin: '관리자', 'team-leader': '팀장', fc: 'FC' })[role]
}

// --- staffService ----------------------------------------------------------
// Cleared: no sample staff. Future: replace with server API (GET /staff).
export const staffService = {
  totalStaff: (): number => 0,
  attendanceToday: (): { present: number; total: number } => ({ present: 0, total: 0 }),
  teamStatus: (_teamName?: string): TeamMemberStatus[] => []
}

// --- attendanceService -----------------------------------------------------
// Cleared: no sample attendance. Future: replace with server API (GET/POST /attendance).
export const attendanceService = {
  myStatus: (): AttendanceInfo => ({ checkedIn: false, status: '미출근' }),
  teamPresent: (): { present: number; total: number } => ({ present: 0, total: 0 })
}

// --- customerService -------------------------------------------------------
// Cleared: no sample customers. Future: replace with server API (GET /customers).
export const customerService = {
  summary: (): CustomerSummary => ({ total: 0, pending: 0, todayConsultations: 0 }),
  teamProgressRate: (): number => 0
}

// --- performanceService ----------------------------------------------------
// Cleared: no sample performance. Future: replace with server API (GET /performance).
export const performanceService = {
  mySummary: (): PerformanceSummary => ({ monthlyCount: 0, monthlyPremium: '0원', target: '0원', achievementRate: 0 }),
  teamSummary: (): PerformanceSummary => ({ monthlyCount: 0, monthlyPremium: '0원', target: '0원', achievementRate: 0 }),
  companySummary: (): PerformanceSummary => ({ monthlyCount: 0, monthlyPremium: '0원', target: '0원', achievementRate: 0 })
}

// --- noticeService ---------------------------------------------------------
// Cleared: no sample notices. Future: replace with server API (GET /notices).
export const noticeService = {
  list: (): Notice[] => []
}
