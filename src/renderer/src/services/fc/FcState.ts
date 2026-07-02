import type { FcSnapshot } from './types'
import { fcSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './fcPersistence'

/**
 * Holds the current FC OS snapshot. Seeds from persisted local state when
 * present, otherwise from the realistic mock seed. Every set persists, so the
 * roster and attendance survive restarts. Mirrors DevOsState / CompanyState.
 */
export class FcState {
  private snapshot: FcSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: FcSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? fcSeed
  }

  getSnapshot(): FcSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: FcSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
