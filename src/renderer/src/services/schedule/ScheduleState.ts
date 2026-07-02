import type { ScheduleSnapshot } from './types'
import { scheduleSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './schedulePersistence'

/**
 * Holds the current Schedule Workspace snapshot. Seeds from persisted local
 * state when present, otherwise from the realistic mock seed. Every set
 * persists, so the shared calendar survives restarts. Mirrors
 * SalesActivityState.
 */
export class ScheduleState {
  private snapshot: ScheduleSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: ScheduleSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? scheduleSeed
  }

  getSnapshot(): ScheduleSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: ScheduleSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
