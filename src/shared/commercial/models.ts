/**
 * Commercial staff data models (shared contract).
 *
 * These are the canonical shapes that will move from local/mock data to a shared
 * backend + database. They are storage/transport agnostic — the same interfaces
 * back the current local-mock repositories and the future server API. No secrets,
 * no server URLs here.
 */

export type StaffRole = 'owner' | 'admin' | 'team-leader' | 'fc'

export interface StaffUser {
  id: string
  name: string
  role: StaffRole
  teamId?: string
  teamName?: string
  phone?: string
  email?: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface AttendanceRecord {
  id: string
  staffId: string
  staffName: string
  type: 'check-in' | 'check-out'
  status: 'normal' | 'late' | 'early-leave' | 'missing'
  timestamp: string
  photoUrl?: string
  watermarkText?: string
  memo?: string
}

export type CustomerStatus =
  | 'new'
  | 'contacted'
  | 'consulting'
  | 'proposal'
  | 'closing'
  | 'contracted'
  | 'lost'

export interface CustomerRecord {
  id: string
  ownerStaffId: string
  ownerStaffName: string
  teamId?: string
  name: string
  phone?: string
  birthDate?: string
  address?: string
  source?: string
  status: CustomerStatus
  tags: string[]
  memo?: string
  createdAt: string
  updatedAt: string
}

export interface ConsultationRecord {
  id: string
  customerId: string
  staffId: string
  staffName: string
  consultationType: 'first' | 'follow-up' | 'proposal' | 'closing' | 'aftercare'
  status: 'planned' | 'completed' | 'cancelled'
  summary: string
  nextAction?: string
  scheduledAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ScheduleEvent {
  id: string
  staffId: string
  staffName: string
  customerId?: string
  title: string
  type: 'consultation' | 'contract' | 'follow-up' | 'internal' | 'personal'
  startsAt: string
  endsAt?: string
  status: 'planned' | 'done' | 'cancelled'
  memo?: string
}

export interface PerformanceRecord {
  id: string
  staffId: string
  staffName: string
  teamId?: string
  month: string // YYYY-MM
  lifePremium?: number
  nonLifePremium?: number
  shortTermPremium?: number
  totalPremium: number
  contractCount: number
  createdAt: string
  updatedAt: string
}

export interface NoticeRecord {
  id: string
  title: string
  content: string
  targetRoles: StaffRole[]
  createdBy: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}
