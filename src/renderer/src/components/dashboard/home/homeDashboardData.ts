export type SystemStatusState = 'checking' | 'connected' | 'failed'

export interface HomeSystemStatus {
  name: string
  state: SystemStatusState
  detail: string
}

export interface HomeMetric {
  label: string
  value: string
  hint: string
}

export interface HomeActivityItem {
  title: string
  meta: string
  tone: 'success' | 'info' | 'warning'
}

export function getStatusLabel(state: SystemStatusState): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'failed':
      return 'Failed'
    case 'checking':
    default:
      return 'Checking...'
  }
}

export function getStatusTone(state: SystemStatusState): string {
  switch (state) {
    case 'connected':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'failed':
      return 'bg-rose-500/15 text-rose-300'
    case 'checking':
    default:
      return 'bg-amber-500/15 text-amber-300'
  }
}

export const systemStatuses: HomeSystemStatus[] = [
  { name: 'Git', state: 'connected', detail: 'Repository synced' },
  { name: 'API', state: 'connected', detail: 'All endpoints healthy' },
  { name: 'Database', state: 'checking', detail: 'Verifying latest sync' },
  { name: 'AI', state: 'connected', detail: 'Workers responsive' },
  { name: 'Server', state: 'failed', detail: 'Temporary latency spike' }
]

export const summaryMetrics: HomeMetric[] = [
  { label: 'Employees online', value: '18', hint: 'Hybrid team active' },
  { label: "Today's appointments", value: '7', hint: '2 high priority' },
  { label: "Today's sales", value: '$18.4K', hint: 'Up 12% vs yesterday' },
  { label: 'Pending tasks', value: '11', hint: '4 require review' },
  { label: 'Notifications', value: '3', hint: '2 approvals pending' }
]

export const executiveBriefing = [
  'Launch the claims insight sprint before noon.',
  'Reconfirm customer protection priorities with the product team.',
  'Review the release approval queue and unblock the next publish.'
]

export const quickActions = [
  'Start SJ Jarvis',
  'Customer Search',
  'Insurance Analysis',
  "Today's Schedule",
  'Performance Dashboard',
  'Settings'
]

export const recentActivity: HomeActivityItem[] = [
  { title: 'CEO briefing generated', meta: '5 min ago', tone: 'success' },
  { title: 'Claims intake API verified', meta: '12 min ago', tone: 'info' },
  { title: 'Release approval pending', meta: '18 min ago', tone: 'warning' },
  { title: 'Startup completed successfully', meta: '32 min ago', tone: 'success' }
]
