import { DEMO_USERS, type UserRole } from '@renderer/navigation/roleAccess'

/**
 * MVP service boundaries. These return LOCAL/MOCK data so the staff-facing UI is
 * usable immediately. Each is a clean seam to swap for a real server API later.
 *
 * Future: replace every function body with a server API call (REST/RPC). Keep the
 * signatures stable so the UI does not change. No backend / database is connected
 * in this sprint. Marked clearly in the UI as "상용 MVP 로컬 데이터".
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
// Future: replace with server API (real session / SSO).
export const authService = {
  listDemoUsers: () => DEMO_USERS,
  roleLabel: (role: UserRole): string =>
    ({ owner: '대표', admin: '관리자', 'team-leader': '팀장', fc: 'FC' })[role]
}

// --- staffService ----------------------------------------------------------
// Future: replace with server API (GET /staff).
export const staffService = {
  totalStaff: (): number => 12,
  attendanceToday: (): { present: number; total: number } => ({ present: 9, total: 12 }),
  teamStatus: (_teamName?: string): TeamMemberStatus[] => [
    { name: '김민수', attendance: '출근', todayConsultations: 2, monthlyCount: 6 },
    { name: '이서연', attendance: '출근', todayConsultations: 1, monthlyCount: 4 },
    { name: '정우진', attendance: '외근', todayConsultations: 3, monthlyCount: 8 },
    { name: '한지민', attendance: '미출근', todayConsultations: 0, monthlyCount: 2 }
  ]
}

// --- attendanceService -----------------------------------------------------
// Future: replace with server API (GET/POST /attendance).
export const attendanceService = {
  myStatus: (): AttendanceInfo => ({ checkedIn: true, checkInTime: '08:52', status: '출근' }),
  teamPresent: (): { present: number; total: number } => ({ present: 9, total: 12 })
}

// --- customerService -------------------------------------------------------
// Future: replace with server API (GET /customers).
export const customerService = {
  summary: (): CustomerSummary => ({ total: 48, pending: 5, todayConsultations: 3 }),
  teamProgressRate: (): number => 72
}

// --- performanceService ----------------------------------------------------
// Future: replace with server API (GET /performance).
export const performanceService = {
  mySummary: (): PerformanceSummary => ({ monthlyCount: 5, monthlyPremium: '3,200,000원', target: '5,000,000원', achievementRate: 64 }),
  teamSummary: (): PerformanceSummary => ({ monthlyCount: 20, monthlyPremium: '14,800,000원', target: '20,000,000원', achievementRate: 74 }),
  companySummary: (): PerformanceSummary => ({ monthlyCount: 58, monthlyPremium: '42,500,000원', target: '60,000,000원', achievementRate: 71 })
}

// --- noticeService ---------------------------------------------------------
// Future: replace with server API (GET /notices).
export const noticeService = {
  list: (): Notice[] => [
    { id: 'n1', title: '7월 시책 안내', body: '이번 달 시책 및 목표가 업데이트되었습니다. 실적관리에서 확인하세요.', postedAt: '2026-07-01', pinned: true },
    { id: 'n2', title: '고객 상담 기록 작성 안내', body: '상담 후 상담기록을 당일 입력해 주세요.', postedAt: '2026-07-02' },
    { id: 'n3', title: 'SJ OS 업데이트 안내', body: '새 버전 설치 안내가 배포되었습니다. 담당자 안내를 확인하세요.', postedAt: '2026-07-03' }
  ]
}
