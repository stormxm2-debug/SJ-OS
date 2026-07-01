import type { WorkerRole } from '../types'
import { MockWorker, type Worker } from './worker'
import type { ExecutionStatus } from './types'

/**
 * The default company worker roster: one mock worker per role, registered with
 * the Kernel at boot. These are provider-neutral simulations — EXPLICITLY marked
 * `simulated: true` (Sprint 4 rule) — a real worker (Claude Code, a Python
 * worker, …) replaces one by implementing the `Worker` contract; the Kernel and
 * everything above it are unaffected.
 */

const ROSTER: {
  role: WorkerRole
  displayName: string
  phase: ExecutionStatus
  steps: number
  stepMs: number
}[] = [
  { role: 'cto', displayName: 'CTO Agent', phase: 'planning', steps: 4, stepMs: 200 },
  { role: 'research', displayName: 'Research Engineer', phase: 'researching', steps: 4, stepMs: 200 },
  { role: 'frontend', displayName: 'Frontend Engineer', phase: 'coding', steps: 5, stepMs: 200 },
  { role: 'backend', displayName: 'Backend Engineer', phase: 'coding', steps: 5, stepMs: 200 },
  { role: 'developer', displayName: 'Developer Agent', phase: 'coding', steps: 6, stepMs: 200 },
  { role: 'qa', displayName: 'QA Agent', phase: 'review', steps: 4, stepMs: 200 },
  { role: 'git', displayName: 'Git Manager Agent', phase: 'coding', steps: 3, stepMs: 180 },
  { role: 'documentation', displayName: 'Documentation Agent', phase: 'coding', steps: 3, stepMs: 180 },
  { role: 'release', displayName: 'Release Agent', phase: 'coding', steps: 3, stepMs: 180 }
]

export function createDefaultWorkers(): Worker[] {
  return ROSTER.map(
    (w) =>
      new MockWorker({
        id: `worker-${w.role}`,
        capabilities: [w.role],
        metadata: { displayName: w.displayName, role: w.role, simulated: true },
        phase: w.phase,
        steps: w.steps,
        stepMs: w.stepMs
      })
  )
}
