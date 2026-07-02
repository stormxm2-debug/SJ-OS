import type { CustomerSnapshot } from './types'
import { customerSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './customerPersistence'

/**
 * Holds the current Customer Workspace snapshot. Seeds from persisted local
 * state when present, otherwise from the realistic mock seed. Every set
 * persists, so the pipeline survives restarts. Mirrors FcState / DevOsState.
 */
export class CustomerState {
  private snapshot: CustomerSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: CustomerSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? customerSeed
  }

  getSnapshot(): CustomerSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: CustomerSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
