export interface CompanyStartupBacklogEntry {
  title: string
  priority: 'P0' | 'P1' | 'P2'
  status: 'completed' | 'planned' | 'blocked' | 'in_progress'
  releaseId: string
}

export const STARTUP_BACKLOG: CompanyStartupBacklogEntry[] = [
  { title: 'Customer Journey', priority: 'P0', status: 'completed', releaseId: 'R1' },
  { title: 'Customer Management', priority: 'P0', status: 'completed', releaseId: 'R1' },
  { title: 'Consultation Management', priority: 'P0', status: 'completed', releaseId: 'R1' },
  { title: 'Coverage Summary', priority: 'P0', status: 'completed', releaseId: 'R1' },
  { title: 'Insurance Comparison', priority: 'P0', status: 'planned', releaseId: 'R1' },
  { title: 'Proposal Builder', priority: 'P0', status: 'planned', releaseId: 'R1' },
  { title: 'Dashboard Integration', priority: 'P0', status: 'planned', releaseId: 'R1' }
]

export const STARTUP_RELEASES = [{ id: 'R1', name: 'Release 1' }]
