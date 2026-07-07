import type { QaRun, QaSnapshot } from './types'

/**
 * QA Center seed. Starts empty — real QA runs are recorded as verification
 * happens.
 */

const runs: QaRun[] = []

export const qaSeed: QaSnapshot = {
  runs,
  eventLog: []
}
