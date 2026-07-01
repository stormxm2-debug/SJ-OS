import type { WorkerRole } from './worker'

export type ApprovalKind =
  | 'architecture'
  | 'merge'
  | 'release'
  | 'command'
  | 'spend'

export type ApprovalRisk = 'low' | 'medium' | 'high'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

/** A gated decision routed to the CEO for sign-off. */
export interface ApprovalRequest {
  id: string
  title: string
  description: string
  kind: ApprovalKind
  requestedBy: WorkerRole
  projectId: string | null
  risk: ApprovalRisk
  status: ApprovalStatus
  createdAt: string
}
