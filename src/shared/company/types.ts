export type CompanyEntityKind = 'fc' | 'customer' | 'policy' | 'sale' | 'appointment' | 'task' | 'notification' | 'activity' | 'kpi' | 'approval'

export interface CompanySnapshot {
  fc: FcRecord[]
  customers: CustomerRecord[]
  policies: PolicyRecord[]
  sales: SalesRecord[]
  appointments: AppointmentRecord[]
  tasks: TaskRecord[]
  notifications: NotificationRecord[]
  activity: ActivityRecord[]
  approvals: ApprovalRecord[]
  kpis: KpiRecord[]
}

export interface FcRecord {
  id: string
  name: string
  status: 'active' | 'away' | 'offline'
  attendance: string
  performance: number
  production: number
  rank: string
  commission: number
}

export interface CustomerRecord {
  id: string
  name: string
  segment: string
  tier: string
  contact: string
  policyId: string | null
  lastSeen: string
}

export interface PolicyRecord {
  id: string
  name: string
  type: string
  coverage: string
  premium: number
  status: 'active' | 'draft' | 'review'
}

export interface SalesRecord {
  id: string
  customerId: string
  policyId: string
  amount: number
  closedAt: string
  status: 'won' | 'pending' | 'lost'
}

export interface AppointmentRecord {
  id: string
  title: string
  attendee: string
  scheduledAt: string
  location: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

export interface TaskRecord {
  id: string
  title: string
  owner: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'done'
  dueAt: string
}

export interface NotificationRecord {
  id: string
  title: string
  body: string
  kind: 'system' | 'approval' | 'sales' | 'customer'
  createdAt: string
  unread: boolean
}

export interface ActivityRecord {
  id: string
  summary: string
  actor: string
  createdAt: string
}

export interface ApprovalRecord {
  id: string
  title: string
  description: string
  kind: string
  requestedBy: string
  projectId: string
  risk: 'low' | 'medium' | 'high'
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export interface KpiRecord {
  id: string
  label: string
  value: string
  trend: 'up' | 'down' | 'flat'
  period: string
}
