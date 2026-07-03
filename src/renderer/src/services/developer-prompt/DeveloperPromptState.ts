import type { DeveloperPromptSnapshot } from './types'
import { developerPromptSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './developerPromptPersistence'

/**
 * Holds the current Developer Prompt Center snapshot. Seeds from persisted local
 * state when present, otherwise from the (empty) seed. Every set persists, so
 * Jarvis-registered prompt packets survive restarts. Mirrors the other SJ OS
 * *State classes.
 */
export class DeveloperPromptState {
  private snapshot: DeveloperPromptSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: DeveloperPromptSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? developerPromptSeed
  }

  getSnapshot(): DeveloperPromptSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: DeveloperPromptSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
