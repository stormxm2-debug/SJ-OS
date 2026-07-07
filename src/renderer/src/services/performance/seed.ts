import type { PerformanceSnapshot, ProductionPoint } from './types'

/**
 * Production trend series for the SJ Invest home. Starts empty — real
 * production data is derived from staff activity as it is entered.
 */

const daily: ProductionPoint[] = []

const weekly: ProductionPoint[] = []

const monthly: ProductionPoint[] = []

export const performanceSeed: PerformanceSnapshot = {
  daily,
  weekly,
  monthly,
  selectedView: 'monthly',
  eventLog: []
}
