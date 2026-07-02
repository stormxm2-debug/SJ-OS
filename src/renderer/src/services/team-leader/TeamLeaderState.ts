import type { TeamLeaderSnapshot } from './types'
import { teamLeaderSeed } from './seed'
import { loadSnapshot, saveSnapshot } from './teamLeaderPersistence'

/**
 * Holds the current Team Leader Workspace snapshot (leader-owned coaching notes,
 * blockers, next actions + selected team + log). Seeds from persisted local
 * state when present, otherwise from the realistic mock seed. Every set
 * persists, so the leader's notes survive restarts. Mirrors PerformanceState.
 */
export class TeamLeaderState {
  private snapshot: TeamLeaderSnapshot
  /** True when this state was built from the seed (no persisted state found). */
  readonly seededFresh: boolean

  constructor(snapshot: TeamLeaderSnapshot | null = loadSnapshot()) {
    this.seededFresh = snapshot === null
    this.snapshot = snapshot ?? teamLeaderSeed
  }

  getSnapshot(): TeamLeaderSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: TeamLeaderSnapshot): void {
    this.snapshot = snapshot
    saveSnapshot(snapshot)
  }
}
