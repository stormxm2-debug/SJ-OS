import type { ImplementationSnapshot } from './types'
import { implementationSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './implementationPersistence'

/**
 * Holds the current Implementation Request snapshot. Seeds from persisted local
 * state when present, otherwise from the (empty) seed. Every set persists, so
 * Jarvis-raised requests survive restarts. Mirrors the other SJ OS *State
 * classes.
 */
export class ImplementationState {
  private snapshot: ImplementationSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: ImplementationSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? implementationSeed
  }

  getSnapshot(): ImplementationSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: ImplementationSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
