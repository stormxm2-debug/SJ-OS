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

export type UserRole = 'owner' | 'admin' | 'team-leader' | 'fc'

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: '대표',
  admin: '관리자',
  'team-leader': '팀장',
  fc: 'FC'
}

/** Staff MVP routes — visible to every role. */
export const STAFF_ROUTES: ViewName[] = [
  'staff-home',
  'attendance',
  'customer',
  'consultation',
  'schedule',
  'performance',
  'sales-activity',
  'manager-contacts',
  'underwriting',
  'family-caregiver',
  'insurance-analysis',
  'claim-assistant',
  'wiki',
  'notice',
  'fcos',
  'assistant', // 자비스 / 경영 비서 — available to all roles
  'security-center' // 보안 모듈 학습 — 총무 자리(전산 실행 PC)에서 직원 계정으로 사용
]

/** Team-leader-only additional routes. */
export const TEAM_ROUTES: ViewName[] = ['team-leader']

export type RouteCategory = 'staff' | 'team' | 'admin'

export function routeCategory(name: ViewName): RouteCategory {
  if (STAFF_ROUTES.includes(name)) return 'staff'
  if (TEAM_ROUTES.includes(name)) return 'team'
  return 'admin'
}

/** Whether a role may open a route. Owner/admin can open everything. */
export function canAccessRoute(role: UserRole, name: ViewName): boolean {
  if (role === 'owner' || role === 'admin') return true
  const cat = routeCategory(name)
  if (role === 'team-leader') return cat === 'staff' || cat === 'team'
  return cat === 'staff' // fc
}

export const isAdminRole = (role: UserRole): boolean => role === 'owner' || role === 'admin'

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
  { id: 'u-admin', name: '관리자', role: 'admin', position: '관리자' }
]
