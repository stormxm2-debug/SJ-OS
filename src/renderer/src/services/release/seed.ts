import type { ReleaseItem, ReleaseSnapshot } from './types'

/**
 * Realistic initial Release Center state for the SJ AI Company. Used the first
 * time the app runs (or when persisted state is missing/invalid, or after a
 * reset). After that, the persisted snapshot is the source of truth.
 *
 * The seed captures the current release candidate — the AI Company Foundation
 * v0.1, bundling the DevOS, PM Planner, CTO Room, Approval Center and QA Center
 * that have shipped. QA has passed; CEO approval is still pending and deployment
 * has not started. The FC OS and Insurance AI are explicitly not in this
 * release yet. Ids link to the QA and Approval seeds. Owner ids match the DevOS
 * roster ('devops').
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

const foundationRelease: ReleaseItem = {
  releaseId: 'rel-foundation-v0-1',
  title: 'AI Company Foundation',
  version: 'v0.1',
  status: 'approval-required',
  releaseType: 'internal',
  relatedSprint: 'Sprint 2A',
  relatedEpic: 'AI company operating system',
  relatedFeatures: [
    'Development OS',
    'Worker Memory',
    'PM Planner',
    'CTO Room',
    'Approval Center',
    'QA Center'
  ],
  qaRunId: 'qa-release-readiness',
  approvalId: 'apr-release-readiness',
  buildStatus: 'passed',
  qaStatus: 'passed',
  approvalStatus: 'pending',
  deploymentStatus: 'pending',
  releaseNotes:
    'AI Company Foundation v0.1 — the internal operating system for SJ Invest.\n\n' +
    'Included: Development OS (session + worker memory + event log), PM Planner (epics/features/tasks with DevOS promotion), CTO Room (technical health + priorities), Approval Center (CEO sign-off queue), and QA Center (verification runs and release gates).\n\n' +
    'Not included yet: the FC Operating System (advisor workspaces) and the Insurance AI (coverage / medical / hidden-money analysis) — both remain on the roadmap behind CEO approval.\n\n' +
    'Quality: typecheck and build pass. There is no automated test suite yet; verification is manual plus typecheck/build.',
  blockers: [],
  warnings: ['No automated test suite yet', 'Coverage is unmeasured'],
  checklist: [
    { label: 'Typecheck passing', done: true },
    { label: 'Production build passing', done: true },
    { label: 'QA reviewed', done: true },
    { label: 'Release notes written', done: true },
    { label: 'CEO approval received', done: false },
    { label: 'Deployment target defined', done: false }
  ],
  createdAt: SEED_TIMESTAMP,
  updatedAt: SEED_TIMESTAMP,
  releasedAt: null,
  ownerWorkerId: 'devops'
}

export const releaseSeed: ReleaseSnapshot = {
  releases: [foundationRelease],
  eventLog: []
}
