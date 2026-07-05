import type { StaffRole } from './models'
import type { PasswordStatus, StaffLoginStatus } from './phoneLogin'

/**
 * Team + staff operations models (shared). Organization structure managed by
 * owner/admin only. No secrets, no service_role.
 */

export interface TeamRecord {
  id: string
  name: string
  leaderId?: string
  leaderName?: string
  status: 'active' | 'inactive'
  memberCount?: number
  createdAt: string
  updatedAt: string
}

/** A merged view of a staff member for org management (phone always masked). */
export interface StaffManagementRecord {
  id: string
  profileId?: string
  loginAccountId?: string
  name: string
  phoneMasked: string
  role: StaffRole
  teamId?: string
  teamName?: string
  status: StaffLoginStatus
  passwordStatus: PasswordStatus
  profileLinked: boolean
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export interface OrganizationSummary {
  totalStaff: number
  activeStaff: number
  invited: number
  passwordNotSet: number
  teamCount: number
  inactiveOrBlocked: number
}
