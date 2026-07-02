/**
 * Consultation Workspace — SJ Invest customer consultation-flow types.
 *
 * The Consultation Workspace tracks the full advisory journey for a single
 * customer: 1차 미팅 → 2차 미팅 → 니즈분석 → 증권분석 → 제안 → 클로징 →
 * 계약 → 사후관리, with a per-stage status, a consultation checklist, notes and
 * the next action. Each consultation links to a customer (Customer Workspace)
 * and its assigned FC (FC OS); completing the closing/contract stages can push
 * the matching consultation stage back onto the customer through the Customer
 * Workspace public API. These types are the shape of that state, persisted
 * alongside the FC OS / Customer / Sales Activity / Schedule / Performance /
 * Team Leader memory (no external API, no database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the Team Leader Workspace. All data is mock
 * and local; it holds no real personal or sensitive information.
 */

import type { ConsultationStage } from '@renderer/services/customer/types'

/** The ordered consultation flow stages. */
export type ConsultationFlowStage =
  | 'first-meeting'
  | 'second-meeting'
  | 'needs-analysis'
  | 'policy-review'
  | 'proposal'
  | 'closing'
  | 'contract'
  | 'after-care'

/** Per-stage progress state. */
export type StageStatus = 'pending' | 'active' | 'done' | 'skipped'

/** Overall lifecycle of a consultation. */
export type ConsultationStatus = 'active' | 'won' | 'lost' | 'on-hold'

/** A single stage entry inside a consultation flow. */
export interface StageEntry {
  stage: ConsultationFlowStage
  status: StageStatus
  completedAt: string | null
  note: string
}

/** A single checklist item for the consultation. */
export interface ConsultationChecklistItem {
  id: string
  label: string
  done: boolean
}

/** A single note left on a consultation. */
export interface ConsultationNote {
  id: string
  author: string
  text: string
  createdAt: string
}

/** A full consultation record for one customer. */
export interface Consultation {
  consultationId: string
  customerId: string
  customerName: string
  fcId: string
  fcName: string
  team: string
  status: ConsultationStatus
  currentStage: ConsultationFlowStage
  stages: StageEntry[]
  checklist: ConsultationChecklistItem[]
  notes: ConsultationNote[]
  nextAction: string
  nextActionAt: string | null
  createdAt: string
  updatedAt: string
}

/** Kinds of events recorded in the persisted Consultation event log. */
export type ConsultationLogType =
  | 'created'
  | 'stage-advanced'
  | 'stage-updated'
  | 'checklist-toggled'
  | 'note-added'
  | 'next-action-updated'
  | 'won'
  | 'lost'
  | 'on-hold'
  | 'customer-synced'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Consultation event log. */
export interface ConsultationLogEntry {
  id: string
  type: ConsultationLogType
  message: string
  createdAt: string
}

/** The full persisted Consultation Workspace snapshot. */
export interface ConsultationSnapshot {
  consultations: Consultation[]
  /** Id of the consultation currently open in the detail panel (null = none). */
  selectedConsultationId: string | null
  /** Newest-first log of meaningful Consultation changes. */
  eventLog: ConsultationLogEntry[]
}

/** Organization-wide consultation rollup. */
export interface ConsultationSummary {
  total: number
  active: number
  won: number
  lost: number
  onHold: number
  closingStage: number
  proposalStage: number
  afterCare: number
  /** won / (won + lost), as a percentage. */
  winRate: number
  /** Average number of completed stages across active consultations. */
  avgProgress: number
}

/** Per-stage funnel count. */
export interface StageFunnelRow {
  stage: ConsultationFlowStage
  /** Consultations currently sitting at this stage. */
  count: number
  /** Consultations that have completed this stage. */
  completed: number
}

/** The consultation flow stages, in canonical order. */
export const ORDERED_STAGES: ConsultationFlowStage[] = [
  'first-meeting',
  'second-meeting',
  'needs-analysis',
  'policy-review',
  'proposal',
  'closing',
  'contract',
  'after-care'
]

/** Maps a consultation flow stage onto the Customer Workspace stage. */
export const FLOW_TO_CUSTOMER_STAGE: Record<ConsultationFlowStage, ConsultationStage> = {
  'first-meeting': 'first-contact',
  'second-meeting': 'first-contact',
  'needs-analysis': 'needs-analysis',
  'policy-review': 'policy-review',
  proposal: 'proposal',
  closing: 'closing',
  contract: 'contract',
  'after-care': 'after-care'
}
