import type { QaRun, QaSnapshot } from './types'

/**
 * Realistic initial QA Center state for the SJ AI Company. Used the first time
 * the app runs (or when persisted state is missing/invalid, or after a reset).
 * After that, the persisted snapshot is the source of truth.
 *
 * Runs are newest-first, so runs[0] is the latest QA run. The seed reflects
 * where SJ OS actually stands: full-app typecheck and build pass, the DevOS /
 * PM Planner / CTO Room / Approval Center integrations have been checked, and
 * release readiness plus the future FC OS gate are still pending. Owner ids
 * match the DevOS roster ('qa').
 */

const DEFAULT_DIMENSIONS = {
  typecheckStatus: 'pending',
  buildStatus: 'pending',
  regressionStatus: 'pending',
  securityStatus: 'pending',
  performanceStatus: 'pending',
  coverageStatus: 'pending'
} as const

function run(fields: Partial<QaRun> & Pick<QaRun, 'qaRunId' | 'title' | 'scope' | 'status' | 'startedAt'>): QaRun {
  return {
    ...DEFAULT_DIMENSIONS,
    releaseBlockers: [],
    warnings: [],
    passedChecks: [],
    failedChecks: [],
    completedAt: null,
    ownerWorkerId: 'qa',
    relatedEpic: null,
    relatedFeature: null,
    relatedTask: null,
    ...fields
  }
}

const runs: QaRun[] = [
  run({
    qaRunId: 'qa-release-readiness',
    title: 'Release readiness — AI Company foundation',
    scope: 'release-candidate',
    status: 'pending',
    typecheckStatus: 'passed',
    buildStatus: 'passed',
    regressionStatus: 'warning',
    securityStatus: 'pending',
    performanceStatus: 'pending',
    coverageStatus: 'warning',
    releaseBlockers: ['No automated test suite in place', 'Insurance AI domain model undefined'],
    warnings: ['Coverage is unmeasured — no test harness yet'],
    passedChecks: ['Typecheck (node + web)', 'Production build (main/preload/renderer)'],
    startedAt: '2026-07-02T09:00:00.000Z',
    completedAt: null,
    relatedEpic: 'AI company operating system',
    relatedFeature: 'Company OS foundation',
    relatedTask: 'Gate the foundation for internal release'
  }),
  run({
    qaRunId: 'qa-fc-os-gate',
    title: 'Future FC OS QA gate',
    scope: 'full-app',
    status: 'pending',
    releaseBlockers: ['FC OS not yet approved as the next business sprint'],
    warnings: ['FC OS workspaces are not implemented yet'],
    startedAt: '2026-07-02T08:30:00.000Z',
    completedAt: null,
    relatedEpic: 'FC Operating System',
    relatedFeature: 'FC Home',
    relatedTask: 'Define the FC OS QA gate'
  }),
  run({
    qaRunId: 'qa-approval-center',
    title: 'Approval Center integration check',
    scope: 'approval-center',
    status: 'passed',
    typecheckStatus: 'passed',
    buildStatus: 'passed',
    regressionStatus: 'passed',
    passedChecks: [
      'Approve / reject / defer flow',
      'Import CTO blocked decisions (deterministic, no duplicates)',
      'Decision drives a DevOS event-log entry'
    ],
    startedAt: '2026-07-02T08:00:00.000Z',
    completedAt: '2026-07-02T08:10:00.000Z',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'Approval Center foundation',
    relatedTask: null
  }),
  run({
    qaRunId: 'qa-cto-room',
    title: 'CTO Room integration check',
    scope: 'cto-room',
    status: 'passed',
    typecheckStatus: 'passed',
    buildStatus: 'passed',
    regressionStatus: 'passed',
    passedChecks: [
      'Promote priority updates the DevOS session',
      'Blocked decisions render and clear',
      'PM Planner summary reads live data'
    ],
    startedAt: '2026-07-02T07:30:00.000Z',
    completedAt: '2026-07-02T07:40:00.000Z',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'CTO Room foundation',
    relatedTask: null
  }),
  run({
    qaRunId: 'qa-pm-planner',
    title: 'PM Planner integration check',
    scope: 'pm-planner',
    status: 'passed',
    typecheckStatus: 'passed',
    buildStatus: 'passed',
    regressionStatus: 'passed',
    passedChecks: [
      'Generate plan from a backlog item',
      'Promote a feature to the active DevOS session',
      'Plan persists across reloads'
    ],
    startedAt: '2026-07-02T07:00:00.000Z',
    completedAt: '2026-07-02T07:10:00.000Z',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'PM Planner foundation',
    relatedTask: null
  }),
  run({
    qaRunId: 'qa-devos-regression',
    title: 'DevOS regression',
    scope: 'devos',
    status: 'warning',
    typecheckStatus: 'passed',
    buildStatus: 'passed',
    regressionStatus: 'warning',
    warnings: [
      'Event log is capped at 50 entries — older entries are dropped',
      'New external-note log type added — verify it renders in the DevOS log'
    ],
    passedChecks: ['Session mutations', 'Worker memory updates', 'Blocker add/clear'],
    startedAt: '2026-07-02T06:30:00.000Z',
    completedAt: '2026-07-02T06:40:00.000Z',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'Development OS',
    relatedTask: null
  }),
  run({
    qaRunId: 'qa-full-build',
    title: 'Full app build',
    scope: 'full-app',
    status: 'passed',
    buildStatus: 'passed',
    passedChecks: ['electron-vite build — main', 'electron-vite build — preload', 'electron-vite build — renderer'],
    startedAt: '2026-07-02T06:00:00.000Z',
    completedAt: '2026-07-02T06:05:00.000Z',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'Build pipeline',
    relatedTask: null
  }),
  run({
    qaRunId: 'qa-full-typecheck',
    title: 'Full app typecheck',
    scope: 'full-app',
    status: 'passed',
    typecheckStatus: 'passed',
    passedChecks: ['tsc — node project', 'tsc — web project'],
    startedAt: '2026-07-02T05:30:00.000Z',
    completedAt: '2026-07-02T05:35:00.000Z',
    relatedEpic: 'AI company operating system',
    relatedFeature: 'Build pipeline',
    relatedTask: null
  })
]

export const qaSeed: QaSnapshot = {
  runs,
  eventLog: []
}
