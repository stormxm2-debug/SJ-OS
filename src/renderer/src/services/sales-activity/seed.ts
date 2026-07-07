import type { SalesActivity, SalesActivitySnapshot } from './types'

/**
 * Sales activity heartbeat seed. Starts empty — real activities are logged by
 * staff as they work their pipeline.
 */

const activities: SalesActivity[] = []

export const salesActivitySeed: SalesActivitySnapshot = {
  activities,
  selectedActivityId: null,
  eventLog: []
}
