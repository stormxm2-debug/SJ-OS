/**
 * Insurance Analysis Entry — SJ Invest policy-analysis foundation types.
 *
 * This module is the *entry point* for insurance analysis: a per-customer record
 * of the policy overview, coverage categories, missing coverage, risk tags, an
 * analysis status and a recommendation *placeholder*. It deliberately does NOT
 * call any real AI or external API yet — the recommendation is a local
 * placeholder and the Jarvis entry points describe seams a future analysis
 * engine will fill. Each analysis links to a customer (Customer Workspace) and
 * its assigned FC (FC OS). These types are the shape of that state, persisted
 * alongside the FC OS / Customer / Sales Activity / Schedule / Performance /
 * Team Leader / Consultation memory (no external API, no database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the Consultation Workspace. All data is
 * mock and local; it holds no real personal or sensitive information.
 */

/** Where an analysis stands. Never reaches a real AI-backed state yet. */
export type AnalysisStatus = 'not-started' | 'in-progress' | 'draft' | 'reviewed'

/** Standard Korean insurance coverage categories. */
export type CoverageCategory =
  | 'death'
  | 'diagnosis'
  | 'hospitalization'
  | 'surgery'
  | 'medical-actual'
  | 'disability'
  | 'liability'
  | 'income'
  | 'pension'
  | 'savings'

/** How adequate the current coverage is in a category. */
export type CoverageAdequacy = 'sufficient' | 'partial' | 'insufficient' | 'none'

/** Severity of a missing-coverage gap. */
export type GapSeverity = 'low' | 'medium' | 'high'

/** A policy held or proposed, in the analysis overview. */
export interface AnalysisPolicy {
  id: string
  name: string
  /** e.g. 종신 / 건강 / 실손 / 연금 / 저축. */
  type: string
  insurer: string
  monthlyPremium: number
  coverage: string
  status: 'active' | 'proposed' | 'lapsed'
}

/** A single coverage-category row in the analysis. */
export interface CoverageRow {
  category: CoverageCategory
  /** Current insured amount, in KRW (0 = uninsured). */
  currentAmount: number
  /** Recommended insured amount, in KRW (mock benchmark). */
  recommendedAmount: number
  adequacy: CoverageAdequacy
}

/** A single missing-coverage gap. */
export interface MissingCoverageItem {
  id: string
  category: CoverageCategory
  note: string
  severity: GapSeverity
}

/** A full insurance-analysis record for one customer. */
export interface InsuranceAnalysis {
  analysisId: string
  customerId: string
  customerName: string
  fcId: string
  fcName: string
  team: string
  status: AnalysisStatus
  policies: AnalysisPolicy[]
  coverage: CoverageRow[]
  missingCoverage: MissingCoverageItem[]
  riskTags: string[]
  /**
   * Local recommendation placeholder. Real AI/rule-engine output is a future
   * milestone — see aiReady.
   */
  recommendationPlaceholder: string
  /** Always false in this foundation — flips true once a real engine is wired. */
  aiReady: boolean
  analyzedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Kinds of events recorded in the persisted Insurance Analysis event log. */
export type AnalysisLogType =
  | 'created'
  | 'status-changed'
  | 'recommendation-updated'
  | 'gap-added'
  | 'risk-tag-added'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Analysis event log. */
export interface AnalysisLogEntry {
  id: string
  type: AnalysisLogType
  message: string
  createdAt: string
}

/** The full persisted Insurance Analysis snapshot. */
export interface AnalysisSnapshot {
  analyses: InsuranceAnalysis[]
  /** Id of the analysis currently open in the detail panel (null = none). */
  selectedAnalysisId: string | null
  /** Newest-first log of meaningful Analysis changes. */
  eventLog: AnalysisLogEntry[]
}

/** Organization-wide analysis rollup. */
export interface AnalysisSummary {
  total: number
  notStarted: number
  inProgress: number
  draft: number
  reviewed: number
  totalGaps: number
  highSeverityGaps: number
  /** Analyses with at least one insufficient/none coverage category. */
  underinsured: number
  averageMonthlyPremium: number
}

/**
 * A future Jarvis entry point — a seam a later analysis engine (AI/rule-based)
 * will answer. Described locally now; not yet wired to any AI call.
 */
export interface JarvisEntryPoint {
  key: string
  label: string
  description: string
  /** Always false until a real engine backs it. */
  ready: boolean
}
