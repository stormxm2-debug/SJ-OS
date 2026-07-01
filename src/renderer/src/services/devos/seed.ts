import type { DevOsSnapshot } from './types'

/**
 * Realistic initial Development OS memory for the SJ AI Company. Used the first
 * time the app runs (or when persisted memory is missing/invalid). After that,
 * the persisted snapshot is the source of truth.
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

export const devOsSeed: DevOsSnapshot = {
  session: {
    currentSprint: 'Sprint 2A — Development OS Foundation',
    currentEpic: 'SJ OS remembers development state',
    currentFeature: 'Development Session + Worker Memory',
    currentTask: 'Persist dev session and worker memory locally',
    progress: 20,
    status: 'active',
    startedAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    blockedReason: null,
    nextAction: 'Wire the Development OS view into navigation and verify build'
  },
  workers: [
    {
      workerId: 'cto',
      name: 'ChatGPT',
      role: 'CTO',
      department: 'Executive',
      currentWork: 'Define Development OS memory model and guardrails',
      completedWork: ['Approved Sprint 2A scope', 'Set architecture guardrails'],
      blockedWork: [],
      nextWork: ['Review persistence approach', 'Plan Sprint 2A-2'],
      confidence: 85,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'pm',
      name: 'Project Manager',
      role: 'PM',
      department: 'Product',
      currentWork: 'Track Sprint 2A-1 progress and blockers',
      completedWork: ['Broke down Sprint 2A into tasks'],
      blockedWork: [],
      nextWork: ['Prepare Sprint 2A-2 backlog'],
      confidence: 80,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'architect',
      name: 'Architect',
      role: 'Architect',
      department: 'Architecture',
      currentWork: 'Design devos repository/state/events layer',
      completedWork: ['Confirmed reuse of CompanyRepository pattern'],
      blockedWork: [],
      nextWork: ['Document memory schema in docs'],
      confidence: 82,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'backend',
      name: 'Backend Engineer',
      role: 'Backend Engineer',
      department: 'Engineering',
      currentWork: 'Implement DevOsRepository and local persistence',
      completedWork: [],
      blockedWork: [],
      nextWork: ['Add worker memory mutations', 'Add session mutations'],
      confidence: 75,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'frontend',
      name: 'Frontend Engineer',
      role: 'Frontend Engineer',
      department: 'Engineering',
      currentWork: 'Build the Development OS / Worker Memory view',
      completedWork: [],
      blockedWork: [],
      nextWork: ['Wire view into navigation'],
      confidence: 78,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'qa',
      name: 'QA Engineer',
      role: 'QA Engineer',
      department: 'Quality',
      currentWork: 'Prepare verification checklist for Sprint 2A-1',
      completedWork: [],
      blockedWork: [],
      nextWork: ['Verify typecheck and build pass'],
      confidence: 70,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'devops',
      name: 'DevOps Engineer',
      role: 'DevOps Engineer',
      department: 'Operations',
      currentWork: 'Confirm build pipeline stays green',
      completedWork: [],
      blockedWork: [],
      nextWork: ['Monitor commit + push to origin/main'],
      confidence: 72,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'jarvis',
      name: 'Jarvis Engineer',
      role: 'Jarvis Engineer',
      department: 'Platform',
      currentWork: 'Keep Jarvis service aligned with new memory layer',
      completedWork: ['Cleaned up Jarvis service structure'],
      blockedWork: [],
      nextWork: ['Expose dev session to Jarvis in a later sprint'],
      confidence: 74,
      lastUpdated: SEED_TIMESTAMP
    }
  ]
}
