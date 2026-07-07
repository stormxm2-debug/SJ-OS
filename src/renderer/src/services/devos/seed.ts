import type { DevOsSnapshot } from './types'

/**
 * Realistic initial Development OS memory for the SJ AI Company. Used the first
 * time the app runs (or when persisted memory is missing/invalid, or after a
 * demo reset). After that, the persisted snapshot is the source of truth.
 *
 * Reflects the state after Sprint 2A-1 shipped the DevOS foundation and 2A-1.1
 * makes it interactive.
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

export const devOsSeed: DevOsSnapshot = {
  session: {
    currentSprint: 'Sprint 2A-1.1',
    currentEpic: 'DevOS becomes interactive',
    currentFeature: 'Worker Memory Controls',
    currentTask: 'Add state mutations and event log',
    progress: 35,
    status: 'active',
    startedAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    blockedReason: null,
    nextAction: 'Add PM Planner after DevOS controls are verified'
  },
  // Starts empty — real workers are registered by staff.
  workers: [],
  eventLog: []
}
