import type {
  AttendanceRecord,
  ConsultationRecord,
  CustomerRecord,
  NoticeRecord,
  PerformanceRecord,
  ScheduleEvent,
  StaffRole,
  StaffUser
} from './models'

/**
 * Commercial MVP API contract (shared).
 *
 * Defines the FUTURE server endpoints and their request/response shapes so the
 * renderer's repository layer can swap local-mock for a real API without changing
 * callers. No base URL and no secrets are defined here — the actual host + auth are
 * supplied at runtime via CommercialBackendConfig (never hardcoded, never .env).
 */

export type DataMode = 'local-mock' | 'future-api'
export type AuthMode = 'local-demo' | 'token' | 'session'

/** Safe, secret-free backend configuration. */
export interface CommercialBackendConfig {
  mode: DataMode
  apiBaseUrl?: string // supplied at runtime; NEVER hardcoded or committed
  authMode: AuthMode
  isConfigured: boolean
}

/** Endpoint catalog (method + path template). Paths are relative to apiBaseUrl. */
export const API_ENDPOINTS = {
  auth: {
    login: { method: 'POST', path: '/auth/login' },
    logout: { method: 'POST', path: '/auth/logout' },
    me: { method: 'GET', path: '/auth/me' }
  },
  staff: {
    list: { method: 'GET', path: '/staff' },
    get: { method: 'GET', path: '/staff/:id' },
    create: { method: 'POST', path: '/staff' },
    update: { method: 'PATCH', path: '/staff/:id' }
  },
  attendance: {
    list: { method: 'GET', path: '/attendance' },
    checkIn: { method: 'POST', path: '/attendance/check-in' },
    checkOut: { method: 'POST', path: '/attendance/check-out' }
  },
  customers: {
    list: { method: 'GET', path: '/customers' },
    create: { method: 'POST', path: '/customers' },
    get: { method: 'GET', path: '/customers/:id' },
    update: { method: 'PATCH', path: '/customers/:id' }
  },
  consultations: {
    list: { method: 'GET', path: '/consultations' },
    create: { method: 'POST', path: '/consultations' },
    update: { method: 'PATCH', path: '/consultations/:id' }
  },
  schedules: {
    list: { method: 'GET', path: '/schedules' },
    create: { method: 'POST', path: '/schedules' },
    update: { method: 'PATCH', path: '/schedules/:id' }
  },
  performance: {
    monthly: { method: 'GET', path: '/performance/monthly' },
    create: { method: 'POST', path: '/performance' }
  },
  notices: {
    list: { method: 'GET', path: '/notices' },
    create: { method: 'POST', path: '/notices' },
    update: { method: 'PATCH', path: '/notices/:id' }
  }
} as const

/** Request/response shapes for the future API (mirrors the models). */
export interface LoginRequest {
  userId: string
  // Future: password/token — never stored client-side in plain text.
}
export interface LoginResponse {
  user: StaffUser
  token?: string
}
export interface ListResponse<T> {
  items: T[]
  total: number
}
export type StaffListResponse = ListResponse<StaffUser>
export type AttendanceListResponse = ListResponse<AttendanceRecord>
export type CustomerListResponse = ListResponse<CustomerRecord>
export type ConsultationListResponse = ListResponse<ConsultationRecord>
export type ScheduleListResponse = ListResponse<ScheduleEvent>
export type PerformanceListResponse = ListResponse<PerformanceRecord>
export type NoticeListResponse = ListResponse<NoticeRecord>

/** Role permissions for the future API (documentation + client-side guard hint). */
export const ROLE_PERMISSIONS: Record<StaffRole, { canReadAllTeams: boolean; canManageStaff: boolean; canPostNotice: boolean }> = {
  owner: { canReadAllTeams: true, canManageStaff: true, canPostNotice: true },
  admin: { canReadAllTeams: true, canManageStaff: true, canPostNotice: true },
  'team-leader': { canReadAllTeams: false, canManageStaff: false, canPostNotice: true },
  fc: { canReadAllTeams: false, canManageStaff: false, canPostNotice: false }
}
