import type { PmSnapshot } from './types'

/**
 * PM Planner seed. Starts empty — real backlog items, epics, features and tasks
 * are planned by staff.
 */

export const pmSeed: PmSnapshot = {
  backlogItems: [],
  epics: [],
  features: [],
  tasks: [],
  eventLog: []
}
