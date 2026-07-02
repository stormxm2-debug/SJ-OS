import type { ReleaseSnapshot } from './types'
import { releaseSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './releasePersistence'

/**
 * Holds the current Release Center snapshot. Seeds from persisted local state
 * when present, otherwise from the realistic seed. Every set persists, so
 * releases survive restarts. Mirrors QaState / ApprovalState / CtoState.
 */
export class ReleaseState {
  private snapshot: ReleaseSnapshot

  constructor(snapshot: ReleaseSnapshot = loadSnapshot() ?? releaseSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): ReleaseSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: ReleaseSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
