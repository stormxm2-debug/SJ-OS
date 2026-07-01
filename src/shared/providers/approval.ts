import type { ProviderAction, RiskLevel } from './types'

/**
 * Approval Policy foundation.
 *
 * Every action a provider proposes is risk-classified (safe / warning /
 * dangerous). The policy decides whether an action may proceed automatically or
 * must be escalated to the CEO. The default is conservative:
 *   - safe      → auto-approved
 *   - warning   → requires CEO approval
 *   - dangerous → requires CEO approval
 *
 * In Sprint 3 mock providers only ever propose SAFE actions, so work flows
 * unattended and NO destructive operation is possible. The policy is the
 * foundation a real provider will lean on: when it proposes a dangerous action
 * (e.g. force-push, delete branch, run a shell command), this returns
 * `requires_ceo_approval` and the worker escalates instead of acting.
 */

export type ApprovalDecision = 'auto_approved' | 'requires_ceo_approval'

export interface ApprovalPolicy {
  evaluate(action: ProviderAction): ApprovalDecision
}

const AUTO_APPROVED_RISK: Record<RiskLevel, ApprovalDecision> = {
  safe: 'auto_approved',
  warning: 'requires_ceo_approval',
  dangerous: 'requires_ceo_approval'
}

/** The default, conservative policy: only safe actions auto-approve. */
export class DefaultApprovalPolicy implements ApprovalPolicy {
  evaluate(action: ProviderAction): ApprovalDecision {
    return AUTO_APPROVED_RISK[action.risk]
  }
}

export interface ApprovalReview {
  autoApproved: ProviderAction[]
  pending: ProviderAction[]
}

/** Split a set of proposed actions into auto-approved vs pending-CEO-approval. */
export function reviewActions(
  policy: ApprovalPolicy,
  actions: ProviderAction[]
): ApprovalReview {
  const autoApproved: ProviderAction[] = []
  const pending: ProviderAction[] = []
  for (const action of actions) {
    if (policy.evaluate(action) === 'auto_approved') autoApproved.push(action)
    else pending.push(action)
  }
  return { autoApproved, pending }
}
