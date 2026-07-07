import type { CtoSnapshot } from './types'

/**
 * Initial CTO Room state. Starts clean — the tracked record-lists (technical
 * debt, risks, blocked decisions, next priorities) begin empty and are filled
 * in as the CTO reviews the build. The health/QA/DevOps/release rollups are
 * required singletons, so they are kept but reset to neutral defaults.
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

export const ctoSeed: CtoSnapshot = {
  currentSprint: '',
  activeEpic: '',
  activeFeature: '',
  activeTask: '',

  architectureHealth: {
    score: 0,
    summary: '',
    strengths: [],
    concerns: []
  },

  technicalDebtItems: [],

  riskItems: [],

  blockedDecisions: [],

  nextPriorities: [],

  releaseReadiness: {
    level: 'not_ready',
    score: 0,
    summary: '',
    checklist: []
  },

  qaStatus: {
    signal: 'green',
    summary: '',
    passingChecks: 0,
    totalChecks: 0,
    openIssues: 0
  },

  devOpsStatus: {
    signal: 'green',
    summary: '',
    typecheckPassing: false,
    buildPassing: false,
    pipeline: '',
    lastDeploy: ''
  },

  lastReviewAt: SEED_TIMESTAMP,
  eventLog: []
}
