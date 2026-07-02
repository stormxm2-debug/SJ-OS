import type { ApprovalItem, ApprovalSnapshot } from './types'

/**
 * Realistic initial Approval Center queue for the SJ AI Company. Used the first
 * time the app runs (or when persisted state is missing/invalid, or after a
 * reset). After that, the persisted snapshot is the source of truth.
 *
 * These are the strategic sign-offs SJ OS needs from the CEO before the company
 * can move into its next phases — the FC OS business sprint, external APIs, the
 * insurance / medical / hidden-insurance-money analysis roadmaps, release
 * readiness, and a destructive-operation safety policy. Worker ids match the
 * DevOS roster (cto / pm / architect / backend / frontend / qa / devops).
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

function item(
  approvalId: string,
  fields: Omit<ApprovalItem, 'approvalId' | 'status' | 'decision' | 'decisionReason' | 'createdAt' | 'updatedAt' | 'decidedAt'>
): ApprovalItem {
  return {
    approvalId,
    status: 'pending',
    decision: null,
    decisionReason: null,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    decidedAt: null,
    ...fields
  }
}

const approvals: ApprovalItem[] = [
  item('apr-fc-os-sprint', {
    title: 'Approve FC OS as the next business sprint',
    description:
      'Commit the company to building the FC Operating System (the advisor workspace) as the next business-facing sprint, delivered workspace-by-workspace through the PM Planner.',
    category: 'product',
    requestedByWorkerId: 'pm',
    requestedByRole: 'PM',
    source: 'PM Planner',
    priority: 'P0',
    riskLevel: 'medium',
    impactSummary:
      'Sets the company direction for the next several sprints and sequences all FC workspaces behind it.',
    relatedEpic: 'FC Operating System',
    relatedFeature: 'FC Home',
    relatedTask: 'Build FC OS shell and navigation'
  }),
  item('apr-external-api-policy', {
    title: 'Approve external API integration policy',
    description:
      'Approve a policy for if/when SJ OS may call external APIs. Until approved, the platform stays fully local (mock providers only).',
    category: 'external-api',
    requestedByWorkerId: 'architect',
    requestedByRole: 'Architect',
    source: 'CTO Room',
    priority: 'P1',
    riskLevel: 'high',
    impactSummary:
      'Gates every future external integration; defines the boundary between the local-first OS and networked services.',
    relatedEpic: 'Platform boundaries',
    relatedFeature: 'External API policy',
    relatedTask: null
  }),
  item('apr-insurance-automation-scope', {
    title: 'Approve insurance analysis automation scope',
    description:
      'Approve how far the company may automate insurance analysis — coverage/gap analysis and ranked recommendations — while all data stays local and mocked.',
    category: 'insurance-analysis',
    requestedByWorkerId: 'backend',
    requestedByRole: 'Backend Engineer',
    source: 'CTO Room',
    priority: 'P1',
    riskLevel: 'high',
    impactSummary:
      'Bounds the Insurance Analysis feature line and the level of autonomy given to automated analysis.',
    relatedEpic: 'Insurance AI foundation',
    relatedFeature: 'Insurance Analysis',
    relatedTask: 'Coverage and gap analysis'
  }),
  item('apr-hidden-money-roadmap', {
    title: 'Approve hidden insurance money analysis roadmap',
    description:
      'Approve a roadmap for analysing hidden/underused insurance value for customers. Sensitive by nature — proceeds on local mock data only until signed off.',
    category: 'insurance-analysis',
    requestedByWorkerId: 'cto',
    requestedByRole: 'CTO',
    source: 'CTO Room',
    priority: 'P2',
    riskLevel: 'high',
    impactSummary:
      'Opens a high-value but sensitive analysis area; needs a clear scope before any real data is considered.',
    relatedEpic: 'Insurance AI foundation',
    relatedFeature: 'Hidden money analysis',
    relatedTask: null
  }),
  item('apr-medical-data-roadmap', {
    title: 'Approve medical data analysis roadmap',
    description:
      'Approve a roadmap for medical data analysis. Implies sensitive PII — cannot leave local mock data until a data-handling and consent policy is approved.',
    category: 'customer-data',
    requestedByWorkerId: 'cto',
    requestedByRole: 'CTO',
    source: 'CTO Room',
    priority: 'P1',
    riskLevel: 'critical',
    impactSummary:
      'Highest-sensitivity data area; blocks on an explicit CEO-approved data-handling and consent policy.',
    relatedEpic: 'Insurance AI foundation',
    relatedFeature: 'Medical data analysis',
    relatedTask: null
  }),
  item('apr-release-readiness', {
    title: 'Approve release readiness for the AI Company foundation',
    description:
      'Approve the current DevOS / PM Planner / CTO Room / Approval Center foundation as ready for internal use, acknowledging there is no automated test suite yet.',
    category: 'release',
    requestedByWorkerId: 'qa',
    requestedByRole: 'QA Engineer',
    source: 'CTO Room',
    priority: 'P2',
    riskLevel: 'medium',
    impactSummary:
      'Marks the internal OS foundation as usable; sets expectations for what "released" means at this stage.',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'Company OS foundation',
    relatedTask: null
  }),
  item('apr-destructive-command-policy', {
    title: 'Approve destructive command policy',
    description:
      'Approve the rule that destructive operations (force push, reset --hard, deletes) are never run autonomously and always require an explicit CEO approval item first.',
    category: 'destructive-operation',
    requestedByWorkerId: 'devops',
    requestedByRole: 'DevOps Engineer',
    source: 'CTO Room',
    priority: 'P0',
    riskLevel: 'critical',
    impactSummary:
      'Company-wide safety guardrail; prevents irreversible actions from happening without human sign-off.',
    relatedEpic: 'Engineering safety',
    relatedFeature: 'Destructive-operation policy',
    relatedTask: null
  })
]

export const approvalSeed: ApprovalSnapshot = {
  approvals,
  eventLog: []
}
