import type { CompanySnapshot } from './types'

// Empty company snapshot — the AI-company / live-company views start clean.
// Real data replaces these arrays once a backend is connected.
export const mockCompanySnapshot: CompanySnapshot = {
  fc: [],
  customers: [],
  policies: [],
  sales: [],
  appointments: [],
  tasks: [],
  notifications: [],
  activity: [],
  approvals: [],
  kpis: []
}
