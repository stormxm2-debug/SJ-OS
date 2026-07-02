import type { PerformanceSnapshot, ProductionPoint } from './types'

/**
 * Realistic — but entirely fictional — seed data for the SJ Invest production
 * trend series. Figures are mock only, with no real personal or sensitive
 * information, and are consistent in scale with the FC OS roster totals
 * (organization monthly premium in the tens of millions of KRW). The current
 * bucket of each series roughly matches the live FC OS current-month totals so
 * the trend cards read coherently against the derived summary.
 *
 * Daily = last 10 business days; weekly = last 8 ISO weeks; monthly = last 6
 * months. Values trend gently upward with realistic noise.
 */

const daily: ProductionPoint[] = [
  { periodKey: '2026-06-23', label: '6/23', premium: 3_100_000, contractCount: 2, activityCount: 41 },
  { periodKey: '2026-06-24', label: '6/24', premium: 4_600_000, contractCount: 3, activityCount: 46 },
  { periodKey: '2026-06-25', label: '6/25', premium: 2_800_000, contractCount: 2, activityCount: 38 },
  { periodKey: '2026-06-26', label: '6/26', premium: 5_400_000, contractCount: 4, activityCount: 52 },
  { periodKey: '2026-06-27', label: '6/27', premium: 3_900_000, contractCount: 3, activityCount: 44 },
  { periodKey: '2026-06-30', label: '6/30', premium: 6_200_000, contractCount: 5, activityCount: 57 },
  { periodKey: '2026-07-01', label: '7/1', premium: 4_800_000, contractCount: 3, activityCount: 49 },
  { periodKey: '2026-07-02', label: '7/2', premium: 5_600_000, contractCount: 4, activityCount: 55 }
]

const weekly: ProductionPoint[] = [
  { periodKey: '2026-W22', label: '22주', premium: 18_400_000, contractCount: 13, activityCount: 214 },
  { periodKey: '2026-W23', label: '23주', premium: 21_700_000, contractCount: 15, activityCount: 238 },
  { periodKey: '2026-W24', label: '24주', premium: 19_800_000, contractCount: 14, activityCount: 226 },
  { periodKey: '2026-W25', label: '25주', premium: 24_300_000, contractCount: 17, activityCount: 259 },
  { periodKey: '2026-W26', label: '26주', premium: 22_100_000, contractCount: 16, activityCount: 247 },
  { periodKey: '2026-W27', label: '27주', premium: 26_500_000, contractCount: 19, activityCount: 271 }
]

const monthly: ProductionPoint[] = [
  { periodKey: '2026-02', label: '2월', premium: 68_400_000, contractCount: 49, activityCount: 902 },
  { periodKey: '2026-03', label: '3월', premium: 74_200_000, contractCount: 53, activityCount: 968 },
  { periodKey: '2026-04', label: '4월', premium: 71_800_000, contractCount: 51, activityCount: 941 },
  { periodKey: '2026-05', label: '5월', premium: 79_600_000, contractCount: 57, activityCount: 1_014 },
  { periodKey: '2026-06', label: '6월', premium: 83_300_000, contractCount: 60, activityCount: 1_058 },
  { periodKey: '2026-07', label: '7월', premium: 86_500_000, contractCount: 62, activityCount: 1_092 }
]

export const performanceSeed: PerformanceSnapshot = {
  daily,
  weekly,
  monthly,
  selectedView: 'monthly',
  eventLog: []
}
