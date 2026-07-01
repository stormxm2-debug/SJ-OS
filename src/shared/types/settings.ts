import type { WorkerRole } from './worker'

export type AutonomyLevel = 'supervised' | 'balanced' | 'autonomous'

/** A configurable model/engine option. No vendor is wired into logic — these
 * are data the CEO can edit, which is the whole point of the abstraction. */
export interface ProviderOption {
  id: string
  label: string
  kind: 'planning' | 'coding' | 'general'
  configured: boolean
}

export interface ApprovalPolicy {
  architecture: boolean
  merge: boolean
  release: boolean
  command: boolean
}

export interface CompanySettings {
  companyName: string
  autonomyLevel: AutonomyLevel
  providers: ProviderOption[]
  /** Which provider fulfils each worker role. Swappable per role. */
  roleProviders: Record<WorkerRole, string>
  policy: ApprovalPolicy
}
