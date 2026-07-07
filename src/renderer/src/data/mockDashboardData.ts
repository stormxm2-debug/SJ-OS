import type { ActivityEvent, Notification } from '@shared/types'

export interface DashboardMockMetricState {
  status: 'success' | 'error'
  value: string
  hint: string
  error: string | null
  isFallback: boolean
}

export interface DashboardMockNotificationsState {
  status: 'success' | 'error'
  items: Notification[]
  error: string | null
  isFallback: boolean
}

export interface DashboardMockActivityState {
  status: 'success' | 'error'
  items: ActivityEvent[]
  error: string | null
  isFallback: boolean
}

export interface DashboardMockSnapshot {
  employeesOnline: DashboardMockMetricState
  appointments: DashboardMockMetricState
  sales: DashboardMockMetricState
  pendingTasks: DashboardMockMetricState
  notifications: DashboardMockNotificationsState
  activity: DashboardMockActivityState
}

// Neutral zero-state fallback for the owner dashboard (no live /api/dashboard yet).
// Starts empty so a real company begins from a clean slate — real metrics replace
// these once a backend is connected.
export const mockCompanyData: DashboardMockSnapshot = {
  employeesOnline: {
    status: 'success',
    value: '0',
    hint: '데이터 없음',
    error: null,
    isFallback: true
  },
  appointments: {
    status: 'success',
    value: '0',
    hint: '데이터 없음',
    error: null,
    isFallback: true
  },
  sales: {
    status: 'success',
    value: '₩0',
    hint: '데이터 없음',
    error: null,
    isFallback: true
  },
  pendingTasks: {
    status: 'success',
    value: '0',
    hint: '데이터 없음',
    error: null,
    isFallback: true
  },
  notifications: {
    status: 'success',
    items: [],
    error: null,
    isFallback: true
  },
  activity: {
    status: 'success',
    items: [],
    error: null,
    isFallback: true
  }
}
