import type { ConsultationSnapshot } from './types'
import { consultationSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './consultationPersistence'

/**
 * Holds the current Consultation Workspace snapshot. Seeds from persisted local
 * state when present, otherwise from the realistic mock seed. Every set
 * persists, so consultation flows survive restarts. Mirrors TeamLeaderState.
 */
export class ConsultationState {
  private snapshot: ConsultationSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: ConsultationSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? consultationSeed
  }

  getSnapshot(): ConsultationSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: ConsultationSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
