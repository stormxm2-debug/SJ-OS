import type { ViewName } from './types'

/**
 * Role-based access foundation for the staff commercial MVP.
 *
 * This is a UI/UX access layer (menu visibility + a friendly route guard), NOT a
 * security boundary — there is no backend auth yet. Owner/admin keep full access to
 * every existing route (developer automation, release, deploy, etc.); team leaders
 * and FCs see only staff routes. Nothing is deleted — restricted routes are simply
 * hidden and, if reached directly, show an access-denied card instead of crashing.
 */

export type UserRole = 'owner' | 'admin' | 'team-leader' | 'fc' | 'back-office'

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: '대표',
  admin: '관리자',
  'team-leader': '팀장',
  fc: 'FC',
  'back-office': '총무비서'
}

/** Staff MVP routes — visible to every role. */
export const STAFF_ROUTES: ViewName[] = [
  'staff-home',
  'attendance',
  'fcos',
  'customer',
  'birthdays',
  'stats-report',
  'consultation',
  'schedule',
  'performance',
  'salary',
  'sales-activity',
  'manager-contacts',
  'underwriting',
  'family-caregiver',
  'health-record',
  'claim-finder',
  'insurance-analysis',
  'coverage-analysis',
  'hospital-coverage',
  'claim-assistant',
  'exemptions',
  'wiki',
  'pre-underwriting',
  'disease-exceptions',
  'contacts',
  'leads',
  'referrals',
  'today-contacts',
  'content-studio',
  'knowledge',
  'security-center',
  'plan-request',
  'files',
  'memo',
  'ai-team-guide',
  'app-install',
  'notice'
  // 'assistant'(경영 비서)는 관리자 전용 — 2026-07-20 대표 확정. 자비스 패널(jarvisService)은
  // 라우트가 아니라 별개이므로 전 직원 그대로 사용 가능.
]

/** Team-leader-only additional routes (팀 현황 라우트 제거로 현재 비어 있음). */
export const TEAM_ROUTES: ViewName[] = []

/**
 * 총무비서(back-office)가 접근할 수 없는 라우트.
 *
 * 총무비서는 "관리자 화면 대부분 + 직원 공용 화면"을 쓰되, 아래만 막는다:
 *  - CEO 대시보드(dashboard): 대표 지시로 제외
 *  - 직원/팀 관리(staff-team): 기존 직원의 등급 변경/승격 화면 — 승격 차단 원칙상 제외
 *  - 개발·자동화 도구 전체: 총무 업무 대상이 아님
 * 나머지(직원 현황·정리표·생일 복지·직원 추가·로그인·고객등록 승인·공지 관리·
 * 공유 일정·승인 센터·경영 비서 등)는 허용된다. 등급 변경 자체는 서버(RLS)에서
 * 관리자 전용으로 막혀 있어, staff-login 을 열어줘도 승격은 불가능하다.
 */
export const BACKOFFICE_DENY_ROUTES: ViewName[] = [
  'dashboard',
  'staff-manage',
  'staff-team',
  'app-builder',
  'devprompt',
  'devos',
  'cto',
  'qa',
  'release',
  'devops',
  'autopilot',
  'pm',
  'backlog',
  'workers',
  'worker',
  'projects',
  'remote-runner'
]

export type RouteCategory = 'staff' | 'team' | 'admin'

export function routeCategory(name: ViewName): RouteCategory {
  if (STAFF_ROUTES.includes(name)) return 'staff'
  if (TEAM_ROUTES.includes(name)) return 'team'
  return 'admin'
}

/** 대표(owner) 전용 라우트 — 관리자도 보지 못한다. */
export const OWNER_ONLY_ROUTES: ViewName[] = [
  // 새로 만든 기능은 당분간 대표만 사용. 직원에게 열 때는 이 목록에서 빼면 된다.
  'memo',
  'ai-team-guide',
  // 콘텐츠 보드: 대표 전용으로 시작. 나중에 직원에게 열 때 이 목록에서 뺀다.
  'content-board'
]

/**
 * 총무 상황판(고객등록 현황). 모든 역할이 연다 — 처리 버튼은 화면에서 역할별로 나뉜다
 * (대표·관리자·총무: 처리 / FC·팀장: 본인 건 읽기 전용). DB 정책이 실제 경계다.
 */
export const BACKOFFICE_DESK_ROUTES: ViewName[] = ['backoffice-desk']

/** Whether a role may open a route. Owner/admin can open everything (except owner-only). */
export function canAccessRoute(role: UserRole, name: ViewName): boolean {
  if (OWNER_ONLY_ROUTES.includes(name)) return role === 'owner'
  if (BACKOFFICE_DESK_ROUTES.includes(name)) return true
  if (role === 'owner' || role === 'admin') return true
  // 총무비서: 명시적으로 막은 라우트만 제외하고 전부 허용(관리자 화면 대부분 + 직원 화면).
  if (role === 'back-office') return !BACKOFFICE_DENY_ROUTES.includes(name)
  const cat = routeCategory(name)
  if (role === 'team-leader') return cat === 'staff' || cat === 'team'
  return cat === 'staff' // fc
}

export const isAdminRole = (role: UserRole): boolean => role === 'owner' || role === 'admin'

/** 총무비서 여부. */
export const isBackOffice = (role: UserRole): boolean => role === 'back-office'

/**
 * 관리자형(그룹) 메뉴를 렌더링할 역할 — owner/admin + 총무비서.
 * 실제로 보이는 개별 항목은 반드시 canAccessRoute 로 다시 필터해야 한다
 * (총무비서는 막힌 라우트가 있으므로).
 */
export const canSeeAdminMenu = (role: UserRole): boolean => isAdminRole(role) || isBackOffice(role)

export interface DemoUser {
  id: string
  name: string
  role: UserRole
  teamName?: string
  position?: string
}

/** Local demo accounts for the MVP login shell (no real authentication yet). */
export const DEMO_USERS: DemoUser[] = [
  { id: 'u-kim', name: '김세종', role: 'owner', position: '대표' },
  { id: 'u-oh', name: '오창연', role: 'team-leader', teamName: '1팀', position: '팀장' },
  { id: 'u-park', name: '박상원', role: 'team-leader', teamName: '2팀', position: '팀장' },
  { id: 'u-fc', name: '일반 FC', role: 'fc', teamName: '1팀', position: 'FC' },
  { id: 'u-admin', name: '관리자', role: 'admin', position: '관리자' },
  { id: 'u-backoffice', name: '총무비서', role: 'back-office', position: '총무' }
]
