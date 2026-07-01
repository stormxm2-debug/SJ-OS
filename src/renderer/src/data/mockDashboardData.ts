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

export const mockCompanyData: DashboardMockSnapshot = {
  employeesOnline: {
    status: 'success',
    value: '18',
    hint: 'Hybrid team active',
    error: null,
    isFallback: true
  },
  appointments: {
    status: 'success',
    value: '7',
    hint: '2 high priority',
    error: null,
    isFallback: true
  },
  sales: {
    status: 'success',
    value: '$18.4K',
    hint: 'Up 12% vs yesterday',
    error: null,
    isFallback: true
  },
  pendingTasks: {
    status: 'success',
    value: '11',
    hint: '4 require review',
    error: null,
    isFallback: true
  },
  notifications: {
    status: 'success',
    items: [
      {
        id: 'n-1',
        level: 'action',
        title: 'Release approval required',
        message: 'Release Manager is ready to publish v0.3.0.',
        createdAt: '8m ago',
        requiresApproval: true
      },
      {
        id: 'n-2',
        level: 'success',
        title: 'Pull request merged',
        message: 'Git Manager merged PR #11 into main.',
        createdAt: '12m ago',
        requiresApproval: false
      }
    ],
    error: null,
    isFallback: true
  },
  activity: {
    status: 'success',
    items: [
      {
        id: 'a-1',
        actor: 'developer',
        summary: 'Pushed 3 commits to feat/claims-intake-api',
        createdAt: 'just now'
      },
      {
        id: 'a-2',
        actor: 'qa',
        summary: 'Started verifying PR #12 — auth flow test suite',
        createdAt: '6m ago'
      }
    ],
    error: null,
    isFallback: true
  }
}
