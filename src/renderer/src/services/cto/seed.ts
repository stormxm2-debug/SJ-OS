import type { CtoSnapshot } from './types'

/**
 * Realistic initial CTO Room state for the SJ AI Company. Used the first time
 * the app runs (or when persisted state is missing/invalid, or after a reset).
 * After that, the persisted snapshot is the source of truth.
 *
 * The seed reflects where SJ OS actually stands: the Development OS foundation,
 * Worker Memory, interactive DevOS controls, and the PM Planner have shipped;
 * the CTO Room itself is the current sprint. It looks ahead to the FC OS,
 * Insurance AI, and the medical / hidden-insurance-money analysis work that the
 * platform is being built to support.
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

function ts(): { createdAt: string; updatedAt: string } {
  return { createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP }
}

export const ctoSeed: CtoSnapshot = {
  currentSprint: 'Sprint 2A-3 · CTO Room foundation',
  activeEpic: 'CTO control room',
  activeFeature: 'CTO Room foundation',
  activeTask: 'Stand up CTO service, seed and view',

  architectureHealth: {
    score: 82,
    summary:
      'Foundation is healthy and consistent. Every subsystem (DevOS, Worker Memory, PM Planner, and now the CTO Room) reuses the same local repository + event-bus + persistence pattern, so the platform is coherent and safe to extend. Main watch items are the still-mocked coding backend and the lack of automated tests as surface grows.',
    strengths: [
      'One repeated pattern across DevOS, PM Planner and CTO Room — low cognitive load',
      'Local-first state (localStorage), no external API or database to operate',
      'Kernel and CompanyRepository remain untouched and stable',
      'Typed IPC bridge with context isolation keeps main/renderer boundaries clean'
    ],
    concerns: [
      'Coding backend is still a mock provider — real execution path unproven',
      'No automated test suite yet; verification is typecheck + build + manual QA',
      'Domain services for Insurance AI / medical analysis are not started'
    ]
  },

  technicalDebtItems: [
    {
      id: 'debt-mock-coding-backend',
      title: 'Coding backend is a mock provider (ProviderBackedWorker not wired to real execution)',
      area: 'Providers',
      severity: 'high',
      status: 'open',
      ...ts()
    },
    {
      id: 'debt-no-tests',
      title: 'No automated test suite — regressions only caught by typecheck/build and manual QA',
      area: 'Quality',
      severity: 'high',
      status: 'open',
      ...ts()
    },
    {
      id: 'debt-duplicated-service-scaffolding',
      title: 'Repository/state/events/persistence scaffolding is copy-adapted per service — extract a shared factory later',
      area: 'Shared',
      severity: 'medium',
      status: 'open',
      ...ts()
    },
    {
      id: 'debt-localstorage-only',
      title: 'All persistence is localStorage-only — no export/import or migration story yet',
      area: 'Persistence',
      severity: 'low',
      status: 'open',
      ...ts()
    }
  ],

  riskItems: [
    {
      id: 'risk-insurance-domain-model',
      title: 'Insurance AI domain model undefined — medical + hidden-insurance-money analysis need a real data model',
      area: 'Insurance AI',
      severity: 'high',
      likelihood: 'medium',
      mitigation:
        'Draft a domain model spike behind the existing repository pattern before committing to the FC OS insurance workspaces.',
      status: 'open',
      ...ts()
    },
    {
      id: 'risk-medical-data-sensitivity',
      title: 'Medical data analysis implies sensitive PII handling with no compliance boundary defined',
      area: 'Medical data analysis',
      severity: 'critical',
      likelihood: 'medium',
      mitigation:
        'Keep all medical/insurance data local and mocked until a CEO-approved data-handling and consent policy exists.',
      status: 'open',
      ...ts()
    },
    {
      id: 'risk-fc-os-scope',
      title: 'FC OS is an XL epic (7 workspaces) — risk of scope creep stalling delivery',
      area: 'Future FC OS',
      severity: 'medium',
      likelihood: 'high',
      mitigation:
        'Ship FC OS workspace-by-workspace via the PM Planner; promote one feature to the active DevOS session at a time.',
      status: 'open',
      ...ts()
    },
    {
      id: 'risk-single-mock-provider',
      title: 'Whole company runs on a single mock coding provider — no fallback if the real path misbehaves',
      area: 'Providers',
      severity: 'medium',
      likelihood: 'low',
      mitigation:
        'Keep the provider contract stable so a real Claude-backed provider can drop in without touching the kernel.',
      status: 'open',
      ...ts()
    }
  ],

  blockedDecisions: [
    {
      id: 'decision-medical-data-policy',
      title: 'Approve a data-handling policy for medical & hidden-insurance-money analysis',
      context:
        'Insurance AI and medical analysis cannot move past mock data until the CEO approves how sensitive data is stored, processed and consented to. Blocks the Insurance Analysis feature line.',
      owner: 'CEO',
      status: 'blocked',
      ...ts()
    },
    {
      id: 'decision-real-provider-timing',
      title: 'Decide when to switch from the mock coding provider to a real Claude-backed provider',
      context:
        'The mock provider is fine for building the OS shell, but Insurance AI features will need real execution. Needs a CEO/CTO call on timing and budget.',
      owner: 'CTO',
      status: 'blocked',
      ...ts()
    }
  ],

  nextPriorities: [
    {
      id: 'prio-cto-jarvis',
      title: 'Expose CTO Room + DevOS session to Jarvis',
      rationale:
        'Once Jarvis can read technical health and the active session, the CEO can ask for status and drive priorities by command.',
      priority: 'P1',
      epic: 'Jarvis situational awareness',
      feature: 'Jarvis reads CTO Room and DevOS session',
      task: 'Give Jarvis read access to CTO snapshot and dev session',
      nextAction: 'Design Jarvis read model over CTO + DevOS snapshots',
      createdAt: SEED_TIMESTAMP
    },
    {
      id: 'prio-insurance-domain-spike',
      title: 'Insurance AI domain-model spike',
      rationale:
        'Everything insurance-related (coverage analysis, medical data, hidden-money analysis) blocks on a real, local domain model. De-risk it early.',
      priority: 'P1',
      epic: 'Insurance AI foundation',
      feature: 'Insurance domain model (local, mock data)',
      task: 'Draft insurance/customer/coverage domain model behind the repository pattern',
      nextAction: 'Spike a local insurance domain model with mock data only',
      createdAt: SEED_TIMESTAMP
    },
    {
      id: 'prio-test-harness',
      title: 'Introduce a lightweight test harness',
      rationale:
        'Surface area is growing (DevOS, PM, CTO). A small unit-test harness for the repositories would catch regressions the build cannot.',
      priority: 'P2',
      epic: 'Engineering quality',
      feature: 'Repository unit tests',
      task: 'Add a test runner and cover the repository mutations',
      nextAction: 'Evaluate vitest and add first repository tests',
      createdAt: SEED_TIMESTAMP
    }
  ],

  releaseReadiness: {
    level: 'at_risk',
    score: 68,
    summary:
      'The internal OS is demoable and stable, but not customer-releasable: Insurance AI is unstarted and there is no automated test coverage. Ready for internal CEO/CTO review, not for external release.',
    checklist: [
      { label: 'Typecheck passes', done: true },
      { label: 'Production build passes', done: true },
      { label: 'DevOS, PM Planner and CTO Room wired into navigation', done: true },
      { label: 'Automated test suite', done: false },
      { label: 'Insurance AI domain model defined', done: false },
      { label: 'Medical data-handling policy approved', done: false }
    ]
  },

  qaStatus: {
    signal: 'yellow',
    summary:
      'Manual QA is keeping pace: each sprint is verified by typecheck, build and a click-through. No automated tests yet, so coverage confidence is moderate.',
    passingChecks: 4,
    totalChecks: 6,
    openIssues: 2
  },

  devOpsStatus: {
    signal: 'green',
    summary:
      'Build pipeline is healthy. Every sprint typechecks and builds cleanly, then commits and pushes to origin/main. No deploy target yet — the app runs locally via electron-vite.',
    typecheckPassing: true,
    buildPassing: true,
    pipeline: 'electron-vite (local) · git origin/main',
    lastDeploy: 'PM Planner foundation committed and pushed to origin/main'
  },

  lastReviewAt: SEED_TIMESTAMP,
  eventLog: []
}
