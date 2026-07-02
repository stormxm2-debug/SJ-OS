/**
 * Customer Workspace — insurance sales customer types.
 *
 * SJ Invest sells insurance through FCs. The Customer Workspace is where an FC
 * opens a single customer and works the whole sales relationship: profile,
 * consultation stage, policies, activities, schedules, memos, next action and
 * (later) AI insurance analysis. These types are the shape of that state,
 * persisted locally alongside the FC OS / DevOS / PM / CTO memory (no external
 * API, no database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the FC OS. It does NOT touch the shared
 * CompanyRepository's minimal CustomerRecord — it is the richer sales domain the
 * organization actually works in. All data is mock and local; it holds no real
 * personal or sensitive information.
 */

/** Where a customer stands in the sales relationship. */
export type CustomerStatus =
  | 'lead'
  | 'active'
  | 'consulting'
  | 'proposal-sent'
  | 'contracted'
  | 'dormant'
  | 'follow-up'
  | 'lost'

/** The consultation funnel, in order. */
export type ConsultationStage =
  | 'first-contact'
  | 'needs-analysis'
  | 'policy-review'
  | 'proposal'
  | 'closing'
  | 'contract'
  | 'after-care'

/** How the customer entered the pipeline. */
export type CustomerSource =
  | 'referral'
  | 'existing-customer'
  | 'DB'
  | 'walk-in'
  | 'family'
  | 'online'
  | 'company-campaign'

/** Sales priority ladder. */
export type CustomerPriority = 'low' | 'medium' | 'high' | 'vip'

/** Mock demographic marker. */
export type CustomerGender = 'male' | 'female'

/** A single memo/note left on a customer. */
export interface CustomerMemo {
  id: string
  text: string
  author: string
  createdAt: string
}

/** A single logged sales activity. */
export interface CustomerActivity {
  id: string
  /** e.g. "call", "meeting", "message", "proposal", "contract". */
  type: string
  summary: string
  createdAt: string
}

/** A policy the customer holds or is considering. */
export interface CustomerPolicy {
  id: string
  name: string
  /** e.g. "종신", "건강", "실손", "연금", "저축". */
  type: string
  premium: number
  coverage: string
  status: 'active' | 'proposed' | 'lapsed'
}

/** A single customer in the SJ Invest sales pipeline. */
export interface CustomerRecord {
  customerId: string
  name: string
  phone: string
  age: number
  gender: CustomerGender
  assignedFcId: string
  assignedFcName: string
  team: string
  status: CustomerStatus
  source: CustomerSource
  consultationStage: ConsultationStage
  lastContactedAt: string | null
  nextContactAt: string | null
  memoCount: number
  activityCount: number
  policyCount: number
  /** This customer's monthly premium contribution, in KRW. */
  monthlyPremium: number
  /** Lifetime premium value, in KRW. */
  totalPremium: number
  riskTags: string[]
  priority: CustomerPriority
  createdAt: string
  updatedAt: string
  /** Newest-first sales activity timeline. */
  activities: CustomerActivity[]
  /** Newest-first memos. */
  memos: CustomerMemo[]
  /** Policies held or proposed. */
  policies: CustomerPolicy[]
}

/** Kinds of events recorded in the persisted Customer Workspace event log. */
export type CustomerLogType =
  | 'stage-updated'
  | 'memo-added'
  | 'activity-added'
  | 'next-contact-set'
  | 'fc-assigned'
  | 'priority-updated'
  | 'marked-dormant'
  | 'proposal-sent'
  | 'contracted'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Customer Workspace log. */
export interface CustomerLogEntry {
  id: string
  type: CustomerLogType
  message: string
  createdAt: string
}

/** The full persisted Customer Workspace snapshot. */
export interface CustomerSnapshot {
  customers: CustomerRecord[]
  /** Id of the customer currently open in the workspace (null = none). */
  selectedCustomerId: string | null
  /** Newest-first log of meaningful Customer Workspace changes. */
  eventLog: CustomerLogEntry[]
}

/** Organization-wide customer rollup. */
export interface CustomerSummary {
  total: number
  leads: number
  active: number
  consulting: number
  proposalReady: number
  contracted: number
  followUpNeeded: number
  dormant: number
  lost: number
  monthlyPremiumTotal: number
  totalPremiumTotal: number
  policyTotal: number
}

/** Per-FC customer rollup, for the FC OS integration. */
export interface FcCustomerSummary {
  assignedFcId: string
  assignedFcName: string
  team: string
  total: number
  active: number
  followUpNeeded: number
  proposalReady: number
  dormant: number
  monthlyPremium: number
}

/** One row of the consultation checklist derived from the current stage. */
export interface ConsultationStep {
  stage: ConsultationStage
  label: string
  done: boolean
  current: boolean
}
