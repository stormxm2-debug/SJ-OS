import type { AnalysisSnapshot, InsuranceAnalysis } from './types'

/**
 * Insurance Analysis seed. Starts empty — real coverage analyses are created by
 * staff from a customer's policies.
 */

const analyses: InsuranceAnalysis[] = []

export const analysisSeed: AnalysisSnapshot = {
  analyses,
  selectedAnalysisId: null,
  eventLog: []
}
