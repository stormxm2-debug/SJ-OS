import type { DevOpsSnapshot } from './types'
import { devopsSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './devopsPersistence'

/**
 * Holds the current DevOps Center snapshot. Seeds from persisted local state
 * when present, otherwise from the realistic seed. Every set persists, so
 * deployments survive restarts. Mirrors ReleaseState / QaState / ApprovalState.
 */
export class DevOpsState {
  private snapshot: DevOpsSnapshot

  constructor(snapshot: DevOpsSnapshot = loadSnapshot() ?? devopsSeed) {
    this.snapshot = snapshot
  }

  getSnapshot(): DevOpsSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: DevOpsSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
