import type { DevOsSnapshot } from './types'

/**
 * Realistic initial Development OS memory for the SJ AI Company. Used the first
 * time the app runs (or when persisted memory is missing/invalid, or after a
 * demo reset). After that, the persisted snapshot is the source of truth.
 *
 * Reflects the state after Sprint 2A-1 shipped the DevOS foundation and 2A-1.1
 * makes it interactive.
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

export const devOsSeed: DevOsSnapshot = {
  session: {
    currentSprint: 'Sprint 2A-1.1',
    currentEpic: 'DevOS becomes interactive',
    currentFeature: 'Worker Memory Controls',
    currentTask: 'Add state mutations and event log',
    progress: 35,
    status: 'active',
    startedAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    blockedReason: null,
    nextAction: 'Add PM Planner after DevOS controls are verified'
  },
  workers: [
    {
      workerId: 'cto',
      name: 'ChatGPT',
      role: 'CTO',
      department: 'Executive',
      currentWork: 'Review interactive DevOS controls scope',
      completedWork: ['Approved Sprint 2A scope', 'Approved DevOS foundation (2A-1)'],
      blockedWork: [],
      nextWork: ['Plan PM Planner sprint', 'Define worker autonomy rules'],
      confidence: 85,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'pm',
      name: 'Project Manager',
      role: 'PM',
      department: 'Product',
      currentWork: 'Track Sprint 2A-1.1 controls and event log',
      completedWork: ['Broke down Sprint 2A into tasks', 'Closed out 2A-1 foundation'],
      blockedWork: [],
      nextWork: ['Draft PM Planner backlog'],
      confidence: 80,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'architect',
      name: 'Architect',
      role: 'Architect',
      department: 'Architecture',
      currentWork: 'Keep devos repository logic clean as controls grow',
      completedWork: ['Confirmed reuse of CompanyRepository pattern', 'Designed devos state/events/repository layer'],
      blockedWork: [],
      nextWork: ['Document memory + event-log schema'],
      confidence: 82,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'backend',
      name: 'Backend Engineer',
      role: 'Backend Engineer',
      department: 'Engineering',
      currentWork: 'Implement DevOS mutation methods and persisted event log',
      completedWork: ['Built DevOsRepository and local persistence'],
      blockedWork: [],
      nextWork: ['Expose session mutations to Jarvis later'],
      confidence: 78,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'frontend',
      name: 'Frontend Engineer',
      role: 'Frontend Engineer',
      department: 'Engineering',
      currentWork: 'Build DevOS quick actions and worker controls',
      completedWork: ['Built Development OS / Worker Memory view', 'Wired view into navigation'],
      blockedWork: [],
      nextWork: ['Polish event log presentation'],
      confidence: 80,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'qa',
      name: 'QA Engineer',
      role: 'QA Engineer',
      department: 'Quality',
      currentWork: 'Verify DevOS controls and persistence behavior',
      completedWork: ['Verified 2A-1 typecheck and build'],
      blockedWork: [],
      nextWork: ['Add checklist for event-log correctness'],
      confidence: 74,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'devops',
      name: 'DevOps Engineer',
      role: 'DevOps Engineer',
      department: 'Operations',
      currentWork: 'Keep build pipeline green through 2A-1.1',
      completedWork: ['Monitored 2A-1 commit + push to origin/main'],
      blockedWork: [],
      nextWork: ['Watch commit + push for 2A-1.1'],
      confidence: 74,
      lastUpdated: SEED_TIMESTAMP
    },
    {
      workerId: 'jarvis',
      name: 'Jarvis Engineer',
      role: 'Jarvis Engineer',
      department: 'Platform',
      currentWork: 'Prepare Jarvis to read DevOS session and event log',
      completedWork: ['Cleaned up Jarvis service structure'],
      blockedWork: [],
      nextWork: ['Expose dev session to Jarvis in a later sprint'],
      confidence: 75,
      lastUpdated: SEED_TIMESTAMP
    }
  ],
  eventLog: []
}
