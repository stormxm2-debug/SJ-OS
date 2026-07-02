import type { CtoSnapshot } from './types'
import { ctoSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './ctoPersistence'

/**
 * Holds the current CTO Room snapshot. Seeds from persisted local state when
 * present, otherwise from the realistic seed. Every set persists, so CTO state
 * survives restarts. Mirrors PmState / DevOsState / CompanyState.
 */
export class CtoState {
  private snapshot: CtoSnapshot

  constructor(snapshot: CtoSnapshot = loadSnapshot() ?? ctoSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): CtoSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: CtoSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
