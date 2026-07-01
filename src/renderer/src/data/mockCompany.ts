import type {
  Worker,
  Project,
  Task,
  Notification,
  ActivityEvent
} from '@shared/types'

/**
 * Milestone 2 mock data. This is the ONLY place fake data lives. A later
 * milestone replaces these exports with live orchestrator state delivered over
 * IPC — the dashboard components and the `useCompanyState` hook stay unchanged.
 */

export const workers: Worker[] = [
  {
    id: 'w-cto',
    name: 'CTO Agent',
    title: 'Chief Technology Officer',
    role: 'cto',
    avatar: 'CTO',
    status: 'working',
    currentTask: 'Designing architecture for "Insurance Claims Portal"',
    progress: 68,
    lastActivity: '2m ago'
  },
  {
    id: 'w-dev',
    name: 'Claude Developer',
    title: 'Senior Software Engineer',
    role: 'developer',
    avatar: 'DEV',
    status: 'working',
    currentTask: 'Implementing claims intake API endpoints',
    progress: 41,
    lastActivity: 'just now'
  },
  {
    id: 'w-qa',
    name: 'QA Engineer',
    title: 'Quality Assurance',
    role: 'qa',
    avatar: 'QA',
    status: 'review',
    currentTask: 'Verifying PR #12 — auth flow test suite',
    progress: 80,
    lastActivity: '6m ago'
  },
  {
    id: 'w-git',
    name: 'Git Manager',
    title: 'Version Control',
    role: 'git',
    avatar: 'GIT',
    status: 'idle',
    currentTask: null,
    progress: 0,
    lastActivity: '12m ago'
  },
  {
    id: 'w-docs',
    name: 'Documentation Manager',
    title: 'Technical Writer',
    role: 'documentation',
    avatar: 'DOC',
    status: 'idle',
    currentTask: null,
    progress: 0,
    lastActivity: '24m ago'
  },
  {
    id: 'w-release',
    name: 'Release Manager',
    title: 'Release Engineering',
    role: 'release',
    avatar: 'REL',
    status: 'blocked',
    currentTask: 'Awaiting CEO approval to publish v0.3.0',
    progress: 95,
    lastActivity: '8m ago'
  }
]

export const projects: Project[] = [
  {
    id: 'p-claims',
    name: 'Insurance Claims Portal',
    description: 'Customer-facing claims submission and tracking.',
    status: 'building',
    progress: 62,
    repository: 'sj-ai/claims-portal',
    updatedAt: '2m ago'
  },
  {
    id: 'p-report',
    name: 'Internal Reporting Tool',
    description: 'Automated reconciliation and reporting dashboard.',
    status: 'planning',
    progress: 15,
    repository: 'sj-ai/reporting-tool',
    updatedAt: '31m ago'
  },
  {
    id: 'p-landing',
    name: 'Company Landing Page',
    description: 'Marketing site refresh.',
    status: 'review',
    progress: 88,
    repository: 'sj-ai/landing',
    updatedAt: '1h ago'
  }
]

export const tasks: Task[] = [
  {
    id: 't-1',
    title: 'Claims intake API endpoints',
    projectId: 'p-claims',
    assignedRole: 'developer',
    state: 'in_progress',
    progress: 41
  },
  {
    id: 't-2',
    title: 'Architecture & task breakdown',
    projectId: 'p-claims',
    assignedRole: 'cto',
    state: 'in_progress',
    progress: 68
  },
  {
    id: 't-3',
    title: 'Auth flow test suite (PR #12)',
    projectId: 'p-landing',
    assignedRole: 'qa',
    state: 'in_progress',
    progress: 80
  },
  {
    id: 't-4',
    title: 'Publish release v0.3.0',
    projectId: 'p-landing',
    assignedRole: 'release',
    state: 'awaiting_approval',
    progress: 95
  }
]

export const notifications: Notification[] = [
  {
    id: 'n-1',
    level: 'action',
    title: 'Release approval required',
    message: 'Release Manager is ready to publish v0.3.0 of Company Landing Page.',
    createdAt: '8m ago',
    requiresApproval: true
  },
  {
    id: 'n-2',
    level: 'success',
    title: 'Pull request merged',
    message: 'Git Manager merged PR #11 into main on Insurance Claims Portal.',
    createdAt: '12m ago',
    requiresApproval: false
  },
  {
    id: 'n-3',
    level: 'info',
    title: 'Architecture drafted',
    message: 'CTO Agent finished the architecture draft for Internal Reporting Tool.',
    createdAt: '31m ago',
    requiresApproval: false
  }
]

export const activity: ActivityEvent[] = [
  {
    id: 'a-1',
    actor: 'developer',
    summary: 'Pushed 3 commits to feat/claims-intake-api',
    createdAt: 'just now'
  },
  {
    id: 'a-2',
    actor: 'qa',
    summary: 'Started verifying PR #12 — auth flow test suite',
    createdAt: '6m ago'
  },
  {
    id: 'a-3',
    actor: 'release',
    summary: 'Requested CEO approval to publish v0.3.0',
    createdAt: '8m ago'
  },
  {
    id: 'a-4',
    actor: 'git',
    summary: 'Merged PR #11 into main',
    createdAt: '12m ago'
  },
  {
    id: 'a-5',
    actor: 'ceo',
    summary: 'Created project “Internal Reporting Tool”',
    createdAt: '31m ago'
  },
  {
    id: 'a-6',
    actor: 'system',
    summary: 'AI company started — 6 workers online',
    createdAt: '1h ago'
  }
]
