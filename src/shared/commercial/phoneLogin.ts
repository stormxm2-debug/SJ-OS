import type { StaffRole } from './models'

/**
 * Admin-managed phone login contract (shared).
 *
 * The registered-phone list is an ENTRY GATE only: only registered + active phones
 * may enter. Actual business-data access is still enforced by profiles.role + RLS.
 * No secrets here; no service_role. Real Supabase admin actions (creating auth
 * users, setting passwords) MUST run server-side (Edge Function), never in the
 * renderer.
 */

export type StaffLoginStatus = 'invited' | 'active' | 'inactive' | 'blocked'
export type PasswordStatus = 'not-set' | 'set' | 'reset-requested' | 'reset-approved'

export interface StaffLoginAccount {
  id: string
  name: string
  phone: string
  normalizedPhone: string
  role: StaffRole
  teamId?: string
  teamName?: string
  status: StaffLoginStatus
  passwordStatus: PasswordStatus
  profileId?: string
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export type ResetRequestStatus = 'pending' | 'approved' | 'rejected'

export interface PasswordResetRequest {
  id: string
  normalizedPhone: string
  status: ResetRequestStatus
  requestedAt: string
  approvedAt?: string
  approvedBy?: string
  note?: string
}

export const STAFF_LOGIN_STATUS_LABEL: Record<StaffLoginStatus, string> = {
  invited: '초대됨',
  active: '활성',
  inactive: '비활성',
  blocked: '차단'
}
export const PASSWORD_STATUS_LABEL: Record<PasswordStatus, string> = {
  'not-set': '미설정',
  set: '설정됨',
  'reset-requested': '재설정 요청',
  'reset-approved': '재설정 승인'
}
