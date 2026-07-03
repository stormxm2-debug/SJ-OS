import type { UniversalBuilderSnapshot } from './types'
import { universalBuilderSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './universalBuilderPersistence'

/**
 * Holds the current Universal Builder snapshot. Seeds from persisted local state
 * when present, otherwise from the (empty) seed. Every set persists, so
 * Jarvis-raised build projects survive restarts. Mirrors the other SJ OS *State
 * classes.
 */
export class UniversalBuilderState {
  private snapshot: UniversalBuilderSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: UniversalBuilderSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? universalBuilderSeed
  }

  getSnapshot(): UniversalBuilderSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: UniversalBuilderSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
