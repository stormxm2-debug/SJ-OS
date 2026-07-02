import type { ApprovalSnapshot } from './types'
import { approvalSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './approvalPersistence'

/**
 * Holds the current Approval Center snapshot. Seeds from persisted local state
 * when present, otherwise from the realistic seed. Every set persists, so the
 * approval queue survives restarts. Mirrors CtoState / PmState / DevOsState.
 */
export class ApprovalState {
  private snapshot: ApprovalSnapshot

  constructor(snapshot: ApprovalSnapshot = loadSnapshot() ?? approvalSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): ApprovalSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: ApprovalSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
