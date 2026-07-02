import type { AnalysisSnapshot } from './types'
import { analysisSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './analysisPersistence'

/**
 * Holds the current Insurance Analysis snapshot. Seeds from persisted local
 * state when present, otherwise from the realistic mock seed. Every set
 * persists, so analysis drafts survive restarts. Mirrors ConsultationState.
 */
export class AnalysisState {
  private snapshot: AnalysisSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: AnalysisSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? analysisSeed
  }

  getSnapshot(): AnalysisSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: AnalysisSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
