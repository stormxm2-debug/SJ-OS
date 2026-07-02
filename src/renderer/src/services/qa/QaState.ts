import type { QaSnapshot } from './types'
import { qaSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './qaPersistence'

/**
 * Holds the current QA Center snapshot. Seeds from persisted local state when
 * present, otherwise from the realistic seed. Every set persists, so QA runs
 * survive restarts. Mirrors ApprovalState / CtoState / DevOsState.
 */
export class QaState {
  private snapshot: QaSnapshot

  constructor(snapshot: QaSnapshot = loadSnapshot() ?? qaSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): QaSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: QaSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
