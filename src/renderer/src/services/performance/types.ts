/**
 * Performance Workspace — SJ Invest production & performance types.
 *
 * The Performance Workspace is the production scoreboard of the SJ Invest
 * operating heartbeat: monthly premium, contract count, target achievement,
 * team ranking, FC ranking and daily / weekly / monthly production trends.
 * Current-period FC and team rankings and the production summary are derived
 * live from the FC OS roster (single source of truth for production figures);
 * the daily / weekly / monthly trend series are seeded locally for the trend
 * cards. These types are the shape of that state, persisted locally alongside
 * the FC OS / Customer / Sales Activity / Schedule memory (no external API, no
 * database).
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the Schedule Workspace. All data is mock
 * and local; it holds no real personal or sensitive information.
 */

/** The three production trend granularities. */
export type PeriodView = 'daily' | 'weekly' | 'monthly'

/** A single bucket in a production trend series. */
export interface ProductionPoint {
  /** Stable key for the bucket, e.g. 2026-07-02 / 2026-W27 / 2026-07. */
  periodKey: string
  /** Short display label, e.g. 7/2 · 27주 · 7월. */
  label: string
  premium: number
  contractCount: number
  activityCount: number
}

/** Kinds of events recorded in the persisted Performance event log. */
export type PerformanceLogType = 'view-changed' | 'note-added' | 'foundation' | 'reset'

/** A single, human-readable entry in the persisted Performance event log. */
export interface PerformanceLogEntry {
  id: string
  type: PerformanceLogType
  message: string
  createdAt: string
}

/** The full persisted Performance Workspace snapshot (trend series + log). */
export interface PerformanceSnapshot {
  daily: ProductionPoint[]
  weekly: ProductionPoint[]
  monthly: ProductionPoint[]
  /** The trend view currently selected in the UI. */
  selectedView: PeriodView
  /** Newest-first log of meaningful Performance changes. */
  eventLog: PerformanceLogEntry[]
}

/** Organization-wide production summary (derived live from FC OS). */
export interface PerformanceSummary {
  monthlyPremiumTotal: number
  targetPremiumTotal: number
  contractTotal: number
  achievementRate: number
  producingFcCount: number
  topFcName: string
  topTeamName: string
  averagePremiumPerFc: number
  /** FCs at or above 100% of their monthly target. */
  targetHitCount: number
}

/** Per-FC performance ranking row (derived live from FC OS). */
export interface FcPerformanceRank {
  fcId: string
  fcName: string
  team: string
  role: string
  monthlyPremium: number
  contractCount: number
  targetPremium: number
  achievementRate: number
}

/** Per-team performance ranking row (derived live from FC OS). */
export interface TeamPerformanceRank {
  team: string
  memberCount: number
  monthlyPremium: number
  targetPremium: number
  contractCount: number
  achievementRate: number
}

/** A trend card comparing the latest bucket to the previous one. */
export interface TrendCard {
  label: string
  current: number
  previous: number
  /** Signed percentage change vs. the previous bucket (rounded). */
  deltaPct: number
  direction: 'up' | 'down' | 'flat'
}
