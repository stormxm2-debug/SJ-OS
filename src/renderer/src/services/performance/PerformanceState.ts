import type { PerformanceSnapshot } from './types'
import { performanceSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './performancePersistence'

/**
 * Holds the current Performance Workspace snapshot (trend series + view + log).
 * Seeds from persisted local state when present, otherwise from the realistic
 * mock seed. Every set persists, so the trend view survives restarts. Mirrors
 * ScheduleState.
 */
export class PerformanceState {
  private snapshot: PerformanceSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: PerformanceSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? performanceSeed
  }

  getSnapshot(): PerformanceSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: PerformanceSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
