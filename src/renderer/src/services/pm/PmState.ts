import type { PmSnapshot } from './types'
import { pmSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './pmPersistence'

/**
 * Holds the current PM Planner snapshot. Seeds from persisted local plan data
 * when present, otherwise from the realistic seed. Every set persists, so the
 * plan survives restarts. Mirrors DevOsState / CompanyState.
 */
export class PmState {
  private snapshot: PmSnapshot

  constructor(snapshot: PmSnapshot = loadSnapshot() ?? pmSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): PmSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: PmSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
