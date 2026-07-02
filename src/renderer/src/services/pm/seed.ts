import type {
  PmBacklogItem,
  PmEpic,
  PmFeature,
  PmSnapshot,
  PmTask
} from './types'

/**
 * Realistic initial PM Planner data for the SJ AI Company. Used the first time
 * the app runs (or when persisted plan data is missing/invalid, or after a
 * reset). After that, the persisted snapshot is the source of truth.
 *
 * The seed decomposes the flagship backlog item — "Build FC Operating System"
 * — into one Epic, the FC workspaces as Features, and concrete Tasks, each with
 * acceptance criteria and a suggested worker owner. Worker ids match the DevOS
 * roster (cto / pm / architect / backend / frontend / qa / devops / jarvis).
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

function ts(): { createdAt: string; updatedAt: string } {
  return { createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP }
}

// --- Backlog item ----------------------------------------------------------

const backlogItem: PmBacklogItem = {
  id: 'bl-fc-os',
  kind: 'backlogItem',
  title: 'Build FC Operating System',
  description:
    'A financial consultant (FC) operating system that lets an insurance advisor run their entire day — customers, sales, schedule, activity and analysis — from one AI-assisted workspace.',
  priority: 'P0',
  status: 'in_progress',
  ownerWorkerId: 'pm',
  dependencies: [],
  acceptanceCriteria: [
    'An advisor can reach every core workspace from one shell',
    'Customer, sales and analysis data flow between workspaces',
    'Jarvis can act across the FC OS from a single command surface'
  ],
  estimatedComplexity: 'XL',
  ...ts()
}

// --- Epic ------------------------------------------------------------------

const epic: PmEpic = {
  id: 'epic-fc-os',
  kind: 'epic',
  backlogItemId: 'bl-fc-os',
  title: 'FC Operating System',
  priority: 'P0',
  status: 'in_progress',
  ownerWorkerId: 'architect',
  dependencies: [],
  acceptanceCriteria: [
    'Shared FC OS shell and navigation exist',
    'Each workspace reuses the existing repository + event-bus pattern',
    'No external APIs or database required'
  ],
  estimatedComplexity: 'XL',
  ...ts()
}

// --- Features (the FC workspaces) ------------------------------------------

const features: PmFeature[] = [
  {
    id: 'feat-fc-home',
    kind: 'feature',
    epicId: epic.id,
    title: 'FC Home',
    priority: 'P0',
    status: 'in_progress',
    ownerWorkerId: 'frontend',
    dependencies: [],
    acceptanceCriteria: [
      'Advisor sees today’s priorities on landing',
      'Cards deep-link into each workspace',
      'Reads live local data, no dead widgets'
    ],
    estimatedComplexity: 'M',
    ...ts()
  },
  {
    id: 'feat-customer-workspace',
    kind: 'feature',
    epicId: epic.id,
    title: 'Customer Workspace',
    priority: 'P0',
    status: 'planned',
    ownerWorkerId: 'frontend',
    dependencies: ['feat-fc-home'],
    acceptanceCriteria: [
      'List, search and select a customer',
      'Customer detail shows profile, policies and timeline',
      'Selection persists across workspaces'
    ],
    estimatedComplexity: 'L',
    ...ts()
  },
  {
    id: 'feat-sales-workspace',
    kind: 'feature',
    epicId: epic.id,
    title: 'Sales Workspace',
    priority: 'P0',
    status: 'planned',
    ownerWorkerId: 'backend',
    dependencies: ['feat-customer-workspace'],
    acceptanceCriteria: [
      'Pipeline stages render from local data',
      'Deals link back to a customer',
      'Advisor can advance a deal stage'
    ],
    estimatedComplexity: 'L',
    ...ts()
  },
  {
    id: 'feat-schedule',
    kind: 'feature',
    epicId: epic.id,
    title: 'Schedule',
    priority: 'P1',
    status: 'planned',
    ownerWorkerId: 'frontend',
    dependencies: ['feat-fc-home'],
    acceptanceCriteria: [
      'Day and week views render appointments',
      'Appointments link to a customer',
      'Due follow-ups surface on the schedule'
    ],
    estimatedComplexity: 'M',
    ...ts()
  },
  {
    id: 'feat-activity',
    kind: 'feature',
    epicId: epic.id,
    title: 'Activity',
    priority: 'P1',
    status: 'planned',
    ownerWorkerId: 'backend',
    dependencies: ['feat-customer-workspace'],
    acceptanceCriteria: [
      'Chronological activity feed across workspaces',
      'Filter by customer and activity type',
      'New actions append to the feed'
    ],
    estimatedComplexity: 'M',
    ...ts()
  },
  {
    id: 'feat-jarvis-assistant',
    kind: 'feature',
    epicId: epic.id,
    title: 'Jarvis Assistant',
    priority: 'P0',
    status: 'planned',
    ownerWorkerId: 'jarvis',
    dependencies: ['feat-fc-home', 'feat-customer-workspace'],
    acceptanceCriteria: [
      'Jarvis reads the active workspace context',
      'Advisor can trigger actions by command',
      'Responses reference real local data'
    ],
    estimatedComplexity: 'L',
    ...ts()
  },
  {
    id: 'feat-insurance-analysis',
    kind: 'feature',
    epicId: epic.id,
    title: 'Insurance Analysis',
    priority: 'P0',
    status: 'planned',
    ownerWorkerId: 'backend',
    dependencies: ['feat-customer-workspace'],
    acceptanceCriteria: [
      'Analyse a customer’s coverage and gaps',
      'Produce a ranked set of recommendations (mock)',
      'Feed results into the Sales Workspace'
    ],
    estimatedComplexity: 'L',
    ...ts()
  }
]

// --- Tasks -----------------------------------------------------------------

function task(
  id: string,
  featureId: string,
  title: string,
  ownerWorkerId: string,
  status: PmTask['status'],
  priority: PmTask['priority'],
  estimatedComplexity: PmTask['estimatedComplexity'],
  acceptanceCriteria: string[],
  dependencies: string[] = []
): PmTask {
  return {
    id,
    kind: 'task',
    featureId,
    title,
    priority,
    status,
    ownerWorkerId,
    dependencies,
    acceptanceCriteria,
    estimatedComplexity,
    blocker: null,
    ...ts()
  }
}

const tasks: PmTask[] = [
  // FC Home
  task('task-fc-home-shell', 'feat-fc-home', 'Build FC OS shell and navigation', 'frontend', 'completed', 'P0', 'M', [
    'Shared layout with workspace navigation',
    'Active workspace is highlighted'
  ]),
  task('task-fc-home-today', 'feat-fc-home', 'Build “Today” priorities panel', 'frontend', 'in_progress', 'P0', 'S', [
    'Shows today’s appointments and follow-ups',
    'Cards deep-link into workspaces'
  ], ['task-fc-home-shell']),

  // Customer Workspace
  task('task-customer-list', 'feat-customer-workspace', 'Customer list, search and selection', 'frontend', 'planned', 'P0', 'M', [
    'List and search render from local data',
    'Selecting a customer sets shared context'
  ]),
  task('task-customer-detail', 'feat-customer-workspace', 'Customer detail with profile and timeline', 'frontend', 'planned', 'P0', 'M', [
    'Profile, policies and timeline render',
    'No manual re-selection needed'
  ], ['task-customer-list']),

  // Sales Workspace
  task('task-sales-pipeline', 'feat-sales-workspace', 'Sales pipeline board', 'backend', 'planned', 'P0', 'M', [
    'Stages render from local data',
    'Deals link back to a customer'
  ], ['task-customer-list']),
  task('task-sales-advance', 'feat-sales-workspace', 'Advance a deal through stages', 'backend', 'planned', 'P1', 'S', [
    'Advisor can move a deal forward',
    'Change is logged to activity'
  ], ['task-sales-pipeline']),

  // Schedule
  task('task-schedule-views', 'feat-schedule', 'Day and week schedule views', 'frontend', 'planned', 'P1', 'M', [
    'Day and week views render appointments',
    'Appointments link to a customer'
  ]),
  task('task-schedule-followups', 'feat-schedule', 'Surface due follow-ups on schedule', 'frontend', 'planned', 'P2', 'S', [
    'Due follow-ups appear on the right day',
    'Clicking a follow-up opens the customer'
  ], ['task-schedule-views']),

  // Activity
  task('task-activity-feed', 'feat-activity', 'Cross-workspace activity feed', 'backend', 'planned', 'P1', 'M', [
    'Chronological feed across workspaces',
    'Filter by customer and type'
  ]),

  // Jarvis Assistant
  task('task-jarvis-context', 'feat-jarvis-assistant', 'Give Jarvis active workspace context', 'jarvis', 'planned', 'P0', 'M', [
    'Jarvis reads the active workspace and customer',
    'Context updates as the advisor navigates'
  ]),
  task('task-jarvis-actions', 'feat-jarvis-assistant', 'Let Jarvis trigger FC OS actions', 'jarvis', 'planned', 'P1', 'M', [
    'Advisor can trigger safe actions by command',
    'Every action is confirmed and logged'
  ], ['task-jarvis-context']),

  // Insurance Analysis
  task('task-analysis-coverage', 'feat-insurance-analysis', 'Coverage and gap analysis', 'backend', 'planned', 'P0', 'M', [
    'Analyse a customer’s coverage and gaps',
    'Runs on local mock data only'
  ], ['task-customer-detail']),
  task('task-analysis-recommend', 'feat-insurance-analysis', 'Ranked recommendations (mock)', 'backend', 'planned', 'P1', 'L', [
    'Produces a ranked recommendation list',
    'Results can flow to the Sales Workspace'
  ], ['task-analysis-coverage'])
]

export const pmSeed: PmSnapshot = {
  backlogItems: [backlogItem],
  epics: [epic],
  features,
  tasks,
  eventLog: []
}
