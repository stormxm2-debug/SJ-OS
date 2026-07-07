import type { ApprovalItem, ApprovalSnapshot } from './types'

/**
 * Approval Center seed. Starts empty — real approval items are raised by the
 * organization as decisions need CEO sign-off.
 */

const approvals: ApprovalItem[] = []

export const approvalSeed: ApprovalSnapshot = {
  approvals,
  eventLog: []
}
