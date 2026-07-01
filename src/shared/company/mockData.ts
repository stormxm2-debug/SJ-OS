import type { CompanySnapshot } from './types'

export const mockCompanySnapshot: CompanySnapshot = {
  fc: [
    {
      id: 'fc-001',
      name: 'FC Seoul',
      status: 'active',
      attendance: '09:00',
      performance: 94,
      production: 87,
      rank: 'A+',
      commission: 3210000
    },
    {
      id: 'fc-002',
      name: 'FC Busan',
      status: 'away',
      attendance: '10:15',
      performance: 88,
      production: 79,
      rank: 'A',
      commission: 2840000
    }
  ],
  customers: [
    {
      id: 'cust-001',
      name: 'Kim Ji-hyun',
      segment: 'enterprise',
      tier: 'gold',
      contact: 'kim@example.com',
      policyId: 'policy-001',
      lastSeen: '2h ago'
    },
    {
      id: 'cust-002',
      name: 'Lee Seung-ho',
      segment: 'retail',
      tier: 'silver',
      contact: 'lee@example.com',
      policyId: 'policy-002',
      lastSeen: '5h ago'
    }
  ],
  policies: [
    {
      id: 'policy-001',
      name: 'Premium Life Shield',
      type: 'life',
      coverage: '1.2B KRW',
      premium: 1800000,
      status: 'active'
    },
    {
      id: 'policy-002',
      name: 'Family Care Plus',
      type: 'health',
      coverage: '500M KRW',
      premium: 950000,
      status: 'review'
    }
  ],
  sales: [
    {
      id: 'sale-001',
      customerId: 'cust-001',
      policyId: 'policy-001',
      amount: 1800000,
      closedAt: '2026-07-02',
      status: 'won'
    }
  ],
  appointments: [
    {
      id: 'appt-001',
      title: 'Client Renewal Review',
      attendee: 'Kim Ji-hyun',
      scheduledAt: '2026-07-02 10:30',
      location: 'Seoul HQ',
      status: 'scheduled'
    }
  ],
  tasks: [
    {
      id: 'task-001',
      title: 'Approve policy review',
      owner: 'FC Seoul',
      priority: 'high',
      status: 'pending',
      dueAt: '2026-07-02 16:00'
    }
  ],
  notifications: [
    {
      id: 'notif-001',
      title: 'New approval request',
      body: 'Insurance review requires sign-off',
      kind: 'approval',
      createdAt: '2026-07-02 08:30',
      unread: true
    }
  ],
  activity: [
    {
      id: 'activity-001',
      summary: 'FC Seoul completed the morning attendance check',
      actor: 'system',
      createdAt: '2026-07-02 09:00'
    }
  ],
  approvals: [
    {
      id: 'approval-001',
      title: 'Publish release v0.3.0',
      description: 'Release manager is ready to publish the next release.',
      kind: 'release',
      requestedBy: 'release',
      projectId: 'p-landing',
      risk: 'high',
      status: 'pending',
      createdAt: '8m ago'
    }
  ],
  kpis: [
    {
      id: 'kpi-001',
      label: 'Monthly KPI',
      value: '92%',
      trend: 'up',
      period: 'month'
    },
    {
      id: 'kpi-002',
      label: 'Daily KPI',
      value: '84%',
      trend: 'flat',
      period: 'day'
    }
  ]
}
