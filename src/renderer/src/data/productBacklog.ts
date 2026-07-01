/**
 * SJ Insurance Platform — Product Backlog.
 *
 * The single source of truth for future product work. The Chief of Staff plans
 * from this backlog; departments execute items; the CEO changes priorities.
 * Pure data — no infrastructure, no new architecture.
 */

export type BacklogPriority = 'P0' | 'P1' | 'P2'
export type BacklogStatus = 'completed' | 'in_progress' | 'blocked' | 'planned'
export type Complexity = 'S' | 'M' | 'L' | 'XL'

export interface Release {
  id: string
  name: string
  theme: string
}

export interface BacklogItem {
  id: string
  title: string
  priority: BacklogPriority
  status: BacklogStatus
  releaseId: string
  businessValue: string
  dependencies: string[]
  complexity: Complexity
  ownerDepartment: string
  workflow: string
  acceptanceCriteria: string[]
  definitionOfDone: string[]
}

export const PRODUCT_VISION =
  'Build the best AI-powered insurance advisor platform — one that replaces the repetitive work performed by an insurance advisor.'

export const ROADMAP: Release[] = [
  { id: 'R1', name: 'Release 1', theme: 'Minimum Usable Product (MUP)' },
  { id: 'R2', name: 'Release 2', theme: 'Advisor Productivity' },
  { id: 'R3', name: 'Release 3', theme: 'AI Advisor' },
  { id: 'R4', name: 'Release 4', theme: 'Enterprise Platform' }
]

const DONE_STANDARD = ['Typecheck passes', 'Production build passes', 'UI works with local mock data']

export const BACKLOG: BacklogItem[] = [
  // ---- Release 1 · P0 (Critical) ----
  {
    id: 'MUP-001',
    title: 'Customer Journey',
    priority: 'P0',
    status: 'completed',
    releaseId: 'R1',
    businessValue: 'Ties the advisor workflow into one continuous experience.',
    dependencies: ['MUP-002', 'MUP-003', 'MUP-004'],
    complexity: 'M',
    ownerDepartment: 'Developer',
    workflow: 'Customer → Consultation → Insurance Analysis → Coverage Summary',
    acceptanceCriteria: [
      'Selected customer flows through every step',
      'Each step unlocks the next',
      'No manual re-selection of the customer'
    ],
    definitionOfDone: [...DONE_STANDARD, 'No duplicate workflow state']
  },
  {
    id: 'MUP-002',
    title: 'Customer Management',
    priority: 'P0',
    status: 'completed',
    releaseId: 'R1',
    businessValue: 'Manage the advisor’s book of customers.',
    dependencies: [],
    complexity: 'M',
    ownerDepartment: 'Frontend',
    workflow: 'List → search → select → detail (status, tags, memos, timeline)',
    acceptanceCriteria: ['List and search work', 'Detail shows profile', 'Statistics render'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-003',
    title: 'Consultation Management',
    priority: 'P0',
    status: 'completed',
    releaseId: 'R1',
    businessValue: 'Track consultations against customers.',
    dependencies: ['MUP-002'],
    complexity: 'M',
    ownerDepartment: 'Frontend',
    workflow: 'Pipeline → list → detail (status, type, memos, history, next action)',
    acceptanceCriteria: ['Consultations link to a customer', 'Pipeline renders', 'Detail shows history'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-004',
    title: 'Coverage Summary',
    priority: 'P0',
    status: 'completed',
    releaseId: 'R1',
    businessValue: 'Show a customer’s coverage, premiums and gaps at a glance.',
    dependencies: ['MUP-002', 'Policy'],
    complexity: 'M',
    ownerDepartment: 'Developer',
    workflow: 'Select customer → policies → categories (filter/sort) → missing → recommendation',
    acceptanceCriteria: ['Loads a customer’s policies', 'Filter and sort work', 'Expand/return work'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-005',
    title: 'Insurance Comparison',
    priority: 'P0',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Compare a customer’s coverage against alternative products.',
    dependencies: ['MUP-004', 'Policy'],
    complexity: 'L',
    ownerDepartment: 'Backend',
    workflow: 'Coverage Summary → compare products side by side → highlight differences',
    acceptanceCriteria: ['Side-by-side comparison renders', 'Differences highlighted', 'Uses local mock products'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-006',
    title: 'Proposal Builder',
    priority: 'P0',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Turn an analysis into a customer-ready proposal.',
    dependencies: ['MUP-004', 'MUP-005'],
    complexity: 'L',
    ownerDepartment: 'Frontend',
    workflow: 'Select coverage gaps → assemble proposal → preview → export (mock)',
    acceptanceCriteria: ['Assembles a proposal from gaps', 'Preview renders', 'Export is mocked'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-007',
    title: 'Customer Timeline',
    priority: 'P0',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'One chronological view of everything for a customer.',
    dependencies: ['MUP-002', 'MUP-003'],
    complexity: 'M',
    ownerDepartment: 'Frontend',
    workflow: 'Aggregate customer + consultation + analysis events into one timeline',
    acceptanceCriteria: ['Merges events across domains', 'Chronological order', 'Filter by type'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-008',
    title: 'Dashboard Integration',
    priority: 'P0',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Surface the whole MUP from the main dashboard.',
    dependencies: ['MUP-001', 'MUP-004', 'MUP-007'],
    complexity: 'M',
    ownerDepartment: 'Frontend',
    workflow: 'Wire dashboard cards to live domain data and deep-link into features',
    acceptanceCriteria: ['Dashboard reflects real domain data', 'Cards deep-link', 'No dead widgets'],
    definitionOfDone: [...DONE_STANDARD]
  },

  // ---- Release 1 · P1 ----
  {
    id: 'MUP-101',
    title: 'OCR',
    priority: 'P1',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Extract policy data from documents to cut manual entry.',
    dependencies: ['MUP-104'],
    complexity: 'L',
    ownerDepartment: 'Research',
    workflow: 'Upload document → extract fields (mock) → confirm → import',
    acceptanceCriteria: ['Mock extraction returns fields', 'User confirms', 'Feeds Policy Import'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-102',
    title: 'Hidden Insurance Money',
    priority: 'P1',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Surface unclaimed benefits — a high-value advisor hook.',
    dependencies: ['MUP-004'],
    complexity: 'M',
    ownerDepartment: 'Backend',
    workflow: 'Analyze coverage/claims → flag unclaimed benefits (mock) → summarize',
    acceptanceCriteria: ['Flags mock unclaimed items', 'Shows estimated amount', 'Links to customer'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-103',
    title: 'Medical Data',
    priority: 'P1',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Factor medical history into risk and recommendations.',
    dependencies: ['MUP-002'],
    complexity: 'L',
    ownerDepartment: 'Research',
    workflow: 'Load medical records (mock) → derive risk factors → feed analysis',
    acceptanceCriteria: ['Displays mock medical summary', 'Derives risk factors', 'No real medical integration'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-104',
    title: 'Policy Import',
    priority: 'P1',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Bring existing policies into the platform quickly.',
    dependencies: ['Policy'],
    complexity: 'M',
    ownerDepartment: 'Backend',
    workflow: 'Import policies (mock source) → map to Policy model → attach to customer',
    acceptanceCriteria: ['Imports mock policies', 'Maps to Policy model', 'Attaches to a customer'],
    definitionOfDone: [...DONE_STANDARD]
  },

  // ---- Release 1 · P2 ----
  {
    id: 'MUP-201',
    title: 'AI Recommendation',
    priority: 'P2',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Suggest coverage improvements automatically.',
    dependencies: ['MUP-004', 'MUP-103'],
    complexity: 'L',
    ownerDepartment: 'Research',
    workflow: 'Gaps + risk → ranked recommendations (mock) → present to advisor',
    acceptanceCriteria: ['Produces ranked recommendations', 'Explains each', 'Mock only'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-202',
    title: 'Automatic Consulting Notes',
    priority: 'P2',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Draft consultation notes to save advisor time.',
    dependencies: ['MUP-003'],
    complexity: 'M',
    ownerDepartment: 'Research',
    workflow: 'Consultation context → draft notes (mock) → advisor edits → save',
    acceptanceCriteria: ['Generates a draft note', 'Editable', 'Saved to the consultation'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-203',
    title: 'Automatic Customer Follow-up',
    priority: 'P2',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Never miss a follow-up; keep the pipeline moving.',
    dependencies: ['MUP-003', 'MUP-007'],
    complexity: 'M',
    ownerDepartment: 'Backend',
    workflow: 'Detect due follow-ups → propose actions (mock) → schedule',
    acceptanceCriteria: ['Detects due follow-ups', 'Proposes an action', 'Mock scheduling'],
    definitionOfDone: [...DONE_STANDARD]
  },
  {
    id: 'MUP-204',
    title: 'AI Planner',
    priority: 'P2',
    status: 'planned',
    releaseId: 'R1',
    businessValue: 'Plan a customer’s coverage roadmap over time.',
    dependencies: ['MUP-201'],
    complexity: 'XL',
    ownerDepartment: 'Research',
    workflow: 'Goals + gaps + budget → phased coverage plan (mock)',
    acceptanceCriteria: ['Produces a phased plan', 'Respects a mock budget', 'Mock only'],
    definitionOfDone: [...DONE_STANDARD]
  }
]
