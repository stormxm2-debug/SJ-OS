import type { Capability, Priority } from './types'

/**
 * The AI Meeting domain.
 *
 * A meeting turns a CEO request into a development strategy BEFORE any coding.
 * Every participant produces a REAL opinion derived from the request, the
 * meeting reaches a decision, and that decision DIRECTLY shapes planning:
 * required capabilities, priority, architecture and strategy all flow out of
 * here into the Kernel's task breakdown. Rule-based today, provider-neutral, and
 * replaceable by LLM-backed participants behind the same `MeetingParticipant`
 * contract with no change to the engine.
 */

export type MeetingRole =
  | 'chief_of_staff'
  | 'cto'
  | 'project_manager'
  | 'research'
  | 'developer'
  | 'qa'
  | 'git'
  | 'release'

export const MEETING_PARTICIPANT_ORDER: MeetingRole[] = [
  'chief_of_staff',
  'cto',
  'project_manager',
  'research',
  'developer',
  'qa',
  'git',
  'release'
]

export type MeetingPhase = 'planning' | 'discussion' | 'voting' | 'approved' | 'failed'

export type Vote = 'approve' | 'revise' | 'reject'

export interface ParticipantOpinion {
  role: MeetingRole
  responsibilities: string
  opinion: string
  concerns: string[]
  vote: Vote
  decision: string
  nextAction: string
}

/** The meeting's conclusion — the strategy that drives implementation. */
export interface MeetingDecision {
  architecture: string
  strategy: string
  risks: string[]
  alternatives: string[]
  consensus: string
  /** Which worker capabilities the plan will engage (drives task breakdown). */
  requiredCapabilities: Capability[]
  /** Priority the tasks inherit (drives scheduler ordering). */
  priority: Priority
}

export interface Meeting {
  id: string
  request: string
  phase: MeetingPhase
  participants: MeetingRole[]
  opinions: ParticipantOpinion[]
  decision: MeetingDecision | null
}

/** What the Chief of Staff hands the Meeting Engine to open a meeting. */
export interface ConveneInput {
  request: string
  requestType: string
  size: string
  priorityHint: string
  featureCount: number
}

// ---- Capability + priority policy (meeting → plan) -------------------------

const CAPABILITIES_BY_TYPE: Record<string, Capability[]> = {
  new_project: ['research', 'cto', 'backend', 'frontend', 'developer', 'qa', 'git', 'documentation', 'release'],
  existing_project: ['cto', 'backend', 'frontend', 'developer', 'qa', 'git', 'release'],
  bug_fix: ['backend', 'developer', 'qa', 'git'],
  improvement: ['cto', 'backend', 'frontend', 'developer', 'qa', 'git', 'documentation'],
  research: ['research', 'cto', 'developer', 'documentation']
}

function priorityFromHint(hint: string): Priority {
  if (hint === 'critical') return 'critical'
  if (hint === 'high') return 'high'
  if (hint === 'low') return 'low'
  return 'normal'
}

function isLarge(size: string): boolean {
  return size === 'L' || size === 'XL'
}

// ---- Default participants (rule-based, real) -------------------------------

export interface MeetingParticipant {
  readonly role: MeetingRole
  contribute(input: ConveneInput): ParticipantOpinion
}

function opinion(
  role: MeetingRole,
  responsibilities: string,
  body: Omit<ParticipantOpinion, 'role' | 'responsibilities'>
): ParticipantOpinion {
  return { role, responsibilities, ...body }
}

export function createDefaultParticipants(): MeetingParticipant[] {
  return [
    {
      role: 'chief_of_staff',
      contribute: (i) =>
        opinion('chief_of_staff', 'Frame the request and run the meeting', {
          opinion: `Project identified: a ${i.requestType.replace('_', ' ')} sized ${i.size}. Recommend the standard SDLC pipeline.`,
          concerns: i.priorityHint === 'critical' ? ['Critical priority compresses the schedule.'] : [],
          vote: 'approve',
          decision: 'Proceed to architecture',
          nextAction: 'Convene the team and collect opinions'
        })
    },
    {
      role: 'cto',
      contribute: (i) =>
        opinion('cto', 'Own the architecture and technical direction', {
          opinion: `Propose a modular, provider-neutral architecture${isLarge(i.size) ? ', delivered in phases' : ' in a single phase'}.`,
          concerns: ['Integration boundaries must stay decoupled.'],
          vote: 'approve',
          decision: 'Architecture proposal accepted',
          nextAction: 'Define module interfaces for the Developer'
        })
    },
    {
      role: 'project_manager',
      contribute: (i) =>
        opinion('project_manager', 'Sequence the work and manage delivery', {
          opinion: `Plan ${i.featureCount} feature area(s); sequence tasks so dependencies resolve cleanly.`,
          concerns: isLarge(i.size) ? ['Large scope — recommend incremental delivery.'] : [],
          vote: 'approve',
          decision: 'Backlog sequencing agreed',
          nextAction: 'Turn the architecture into a task breakdown'
        })
    },
    {
      role: 'research',
      contribute: (i) =>
        opinion('research', 'Investigate feasibility and prior art', {
          opinion: `Feasible with well-understood patterns for a ${i.requestType.replace('_', ' ')}. Found reference approaches to reuse.`,
          concerns: i.requestType === 'research' ? ['Outcome may be inconclusive; timebox the spike.'] : [],
          vote: 'approve',
          decision: 'No blocking unknowns',
          nextAction: 'Hand references to the Developer'
        })
    },
    {
      role: 'developer',
      contribute: (i) =>
        opinion('developer', 'Implement the approved plan', {
          opinion: `Implementation is straightforward; estimate ${Math.max(1, i.featureCount)} module(s) with unit tests.`,
          concerns: ['Keep modules small and matched to conventions.'],
          vote: 'approve',
          decision: 'Ready to implement once tasks land',
          nextAction: 'Await task assignment from the Kernel'
        })
    },
    {
      role: 'qa',
      contribute: (i) =>
        opinion('qa', 'Verify quality before merge', {
          opinion:
            i.requestType === 'bug_fix'
              ? 'Add a regression test that reproduces the defect before the fix.'
              : 'Gate the merge on a passing suite and acceptance criteria.',
          concerns: ['Insufficient tests would let regressions through.'],
          vote: i.priorityHint === 'critical' ? 'revise' : 'approve',
          decision: 'Quality gate defined',
          nextAction: 'Prepare the test plan'
        })
    },
    {
      role: 'git',
      contribute: () =>
        opinion('git', 'Own version control and branch strategy', {
          opinion: 'Feature branch per task; PRs into a protected main; no direct pushes.',
          concerns: [],
          vote: 'approve',
          decision: 'Branch strategy prepared',
          nextAction: 'Create branches as tasks are assigned'
        })
    },
    {
      role: 'release',
      contribute: () =>
        opinion('release', 'Own shipping and deployment', {
          opinion: 'Release will be staged and gated on CEO approval before publishing.',
          concerns: ['Deployment requirements must be confirmed before release.'],
          vote: 'approve',
          decision: 'Deployment requirements confirmed',
          nextAction: 'Prepare a staged release'
        })
    }
  ]
}

// ---- Conclusion (opinions → decision) --------------------------------------

export function concludeMeeting(
  input: ConveneInput,
  opinions: ParticipantOpinion[]
): MeetingDecision {
  const cto = opinions.find((o) => o.role === 'cto')
  const risks = dedupe(opinions.flatMap((o) => o.concerns))
  const approvals = opinions.filter((o) => o.vote === 'approve').length
  const revisions = opinions.filter((o) => o.vote === 'revise').length

  const alternatives = [
    isLarge(input.size)
      ? 'Phased delivery of independent modules (recommended for this size)'
      : 'Single-phase delivery (recommended for this size)',
    'Monolithic vs. modular composition — modular chosen for testability'
  ]

  return {
    architecture:
      cto?.opinion ?? 'Modular, provider-neutral architecture with decoupled boundaries.',
    strategy: `Deliver ${input.featureCount} feature area(s) via the standard SDLC pipeline, ${isLarge(input.size) ? 'incrementally' : 'in one phase'}, with the release gated on CEO approval.`,
    risks,
    alternatives,
    consensus: `${approvals}/${opinions.length} approve${revisions ? `, ${revisions} want revisions` : ''} — consensus to proceed.`,
    requiredCapabilities: CAPABILITIES_BY_TYPE[input.requestType] ?? CAPABILITIES_BY_TYPE.new_project,
    priority: priorityFromHint(input.priorityHint)
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)]
}
