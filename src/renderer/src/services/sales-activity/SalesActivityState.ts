import type { SalesActivitySnapshot } from './types'
import { salesActivitySeed } from './seed'
import { loadSnapshot, saveSnapshot } from './salesActivityPersistence'

/**
 * Holds the current Sales Activity Workspace snapshot. Seeds from persisted
 * local state when present, otherwise from the realistic mock seed. Every set
 * persists, so the activity heartbeat survives restarts. Mirrors CustomerState.
 */
export class SalesActivityState {
  private snapshot: SalesActivitySnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: SalesActivitySnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? salesActivitySeed
  }

  getSnapshot(): SalesActivitySnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: SalesActivitySnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
