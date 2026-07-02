import type { AutopilotState } from './types'

/**
 * The initial, idle Autopilot state. Used the first time the app runs (or when
 * persisted state is missing/invalid, or after a demo reset). Autopilot has no
 * run yet — Start Company creates one.
 */
const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

export const autopilotSeed: AutopilotState = {
  autopilotRunId: null,
  status: 'idle',
  currentStep: 0,
  currentDepartment: '—',
  currentWorker: '—',
  currentAction: 'Press Start Company to begin the operating loop.',
  progress: 0,
  startedAt: null,
  updatedAt: SEED_TIMESTAMP,
  completedAt: null,
  blockers: [],
  warnings: [],
  nextAction: 'Start the AI Company operating loop.',
  lastResult: 'Idle — no run started yet.',
  timeline: [],
  activity: []
}
