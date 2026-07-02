import type { DeploymentItem, DevOpsSnapshot } from './types'

/**
 * Realistic initial DevOps Center state for the SJ AI Company. Used the first
 * time the app runs (or when persisted state is missing/invalid, or after a
 * reset). After that, the persisted snapshot is the source of truth.
 *
 * The seed captures the current deployment candidate for the AI Company
 * Foundation v0.1: targeting local/development off the main branch, build and
 * QA passed, CEO approval pending, deployment not started, a rollback plan
 * drafted. Destructive operations are not permitted and no production target is
 * configured yet. Ids link to the Release seed. Owner ids match the DevOS
 * roster ('devops').
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

const foundationDeployment: DeploymentItem = {
  deploymentId: 'dep-foundation-v0-1',
  title: 'AI Company Foundation deployment',
  environment: 'development',
  status: 'draft',
  releaseId: 'rel-foundation-v0-1',
  version: 'v0.1',
  gitBranch: 'main',
  gitCommit: '9070731',
  buildStatus: 'passed',
  qaStatus: 'passed',
  approvalStatus: 'pending',
  deploymentStatus: 'pending',
  artifactStatus: 'ready',
  healthStatus: 'unknown',
  rollbackPlan:
    'No production environment is configured, so rollback stays local: check out the previous commit on main and re-run `npm run build`. ' +
    'Destructive git operations (reset --hard, clean -fd, force push) are never used — rollback is a safe revert only.',
  deploymentLogs: [
    {
      id: 'deplog-seed-1',
      message: 'Deployment candidate drafted for local/development off main.',
      createdAt: SEED_TIMESTAMP
    },
    {
      id: 'deplog-seed-2',
      message: 'Build artifact ready — typecheck and production build pass.',
      createdAt: SEED_TIMESTAMP
    }
  ],
  blockers: [],
  warnings: ['Production deployment is not configured yet', 'No automated test suite in place'],
  checklist: [
    { label: 'Build artifact ready', done: true },
    { label: 'QA passed', done: true },
    { label: 'Rollback plan drafted', done: true },
    { label: 'Environment ready', done: false },
    { label: 'CEO approval received', done: false },
    { label: 'Production target configured', done: false }
  ],
  startedAt: SEED_TIMESTAMP,
  completedAt: null,
  ownerWorkerId: 'devops'
}

export const devopsSeed: DevOpsSnapshot = {
  deployments: [foundationDeployment],
  eventLog: []
}
