import type { DevOsSnapshot } from './types'
import { devOsSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './devOsPersistence'

/**
 * Holds the current Development OS snapshot. Seeds from persisted local memory
 * when present, otherwise from the realistic seed. Every set persists, so the
 * snapshot survives restarts. Mirrors CompanyState.
 */
export class DevOsState {
  private snapshot: DevOsSnapshot

  constructor(snapshot: DevOsSnapshot = loadSnapshot() ?? devOsSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): DevOsSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: DevOsSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
