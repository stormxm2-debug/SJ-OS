import type {
  Worker,
  WorkerRole,
  MemoryEntry,
  ChatMessage,
  ApprovalRequest,
  ProviderOption,
  CompanySettings,
  ActivityEvent
} from '@shared/types'
import { workers } from './mockCompany'

/**
 * Milestone "Company Management" mock data. UI + mock behavior only — no
 * backend, no AI, no APIs. A later milestone replaces these with live state.
 */

export const CAPABILITIES_BY_ROLE: Record<WorkerRole, string[]> = {
  cto: ['Requirements analysis', 'System architecture', 'Tech selection', 'Task breakdown'],
  research: ['Feasibility studies', 'Prior-art review', 'Prototyping', 'Reference gathering'],
  frontend: ['UI components', 'State management', 'API integration', 'Accessibility'],
  backend: ['API design', 'Data modeling', 'Business logic', 'Integrations'],
  developer: ['Implementation', 'Unit testing', 'Refactoring', 'Code review'],
  qa: ['Test planning', 'Automated testing', 'Defect reporting', 'Regression'],
  git: ['Branching', 'Commits', 'Pull requests', 'Merges & tags'],
  documentation: ['README & guides', 'API docs', 'Changelogs', 'Doc review'],
  release: ['Versioning', 'Release notes', 'Build artifacts', 'Publishing']
}

export const STATS_BY_ROLE: Record<
  WorkerRole,
  { completed: number; successRate: number; openTasks: number }
> = {
  cto: { completed: 34, successRate: 96, openTasks: 1 },
  research: { completed: 41, successRate: 95, openTasks: 0 },
  frontend: { completed: 88, successRate: 93, openTasks: 1 },
  backend: { completed: 97, successRate: 94, openTasks: 1 },
  developer: { completed: 128, successRate: 92, openTasks: 1 },
  qa: { completed: 76, successRate: 98, openTasks: 1 },
  git: { completed: 210, successRate: 100, openTasks: 0 },
  documentation: { completed: 54, successRate: 97, openTasks: 0 },
  release: { completed: 19, successRate: 100, openTasks: 1 }
}

const MEMORY: Record<string, MemoryEntry[]> = {
  'w-cto': [
    { id: 'm-cto-1', workerId: 'w-cto', kind: 'preference', content: 'CEO prefers TypeScript + React for internal tools.', createdAt: '3d ago' },
    { id: 'm-cto-2', workerId: 'w-cto', kind: 'fact', content: 'Claims Portal must support Samsung, DB, KB, Hyundai, Meritz.', createdAt: '2d ago' },
    { id: 'm-cto-3', workerId: 'w-cto', kind: 'learning', content: 'Splitting auth into its own service reduced rework last sprint.', createdAt: '6h ago' }
  ],
  'w-dev': [
    { id: 'm-dev-1', workerId: 'w-dev', kind: 'task', content: 'Implementing claims intake API on feat/claims-intake-api.', createdAt: '1h ago' },
    { id: 'm-dev-2', workerId: 'w-dev', kind: 'learning', content: 'Repo uses conventional commits; PRs require QA pass before merge.', createdAt: '1d ago' },
    { id: 'm-dev-3', workerId: 'w-dev', kind: 'preference', content: 'Keep functions small; match existing file conventions.', createdAt: '2d ago' }
  ],
  'w-qa': [
    { id: 'm-qa-1', workerId: 'w-qa', kind: 'fact', content: 'Acceptance criteria for PR #12 live in the CTO task breakdown.', createdAt: '40m ago' },
    { id: 'm-qa-2', workerId: 'w-qa', kind: 'learning', content: 'Flaky auth test fixed by awaiting token refresh.', createdAt: '5h ago' }
  ],
  'w-git': [
    { id: 'm-git-1', workerId: 'w-git', kind: 'fact', content: 'main is protected; all changes land via pull request.', createdAt: '1d ago' },
    { id: 'm-git-2', workerId: 'w-git', kind: 'preference', content: 'AI-authored commits carry a co-author trailer.', createdAt: '2d ago' }
  ],
  'w-docs': [
    { id: 'm-docs-1', workerId: 'w-docs', kind: 'task', content: 'Pending: changelog entry for merged PR #11.', createdAt: '20m ago' },
    { id: 'm-docs-2', workerId: 'w-docs', kind: 'preference', content: 'Docs tone: concise, example-first.', createdAt: '3d ago' }
  ],
  'w-release': [
    { id: 'm-rel-1', workerId: 'w-release', kind: 'task', content: 'v0.3.0 staged; awaiting CEO approval to publish.', createdAt: '8m ago' },
    { id: 'm-rel-2', workerId: 'w-release', kind: 'fact', content: 'Releases are tagged from main and never auto-published.', createdAt: '1d ago' }
  ]
}

export function getMemory(workerId: string): MemoryEntry[] {
  return MEMORY[workerId] ?? []
}

const CHAT: Record<string, ChatMessage[]> = {
  'w-cto': [
    { id: 'c-cto-1', workerId: 'w-cto', author: 'ceo', content: 'How is the Claims Portal architecture coming along?', createdAt: '10m ago' },
    { id: 'c-cto-2', workerId: 'w-cto', author: 'worker', content: 'Drafted the service split and task breakdown — 68% done. I will hand the first tasks to the developer after your sign-off.', createdAt: '9m ago' }
  ],
  'w-dev': [
    { id: 'c-dev-1', workerId: 'w-dev', author: 'ceo', content: 'Focus on the claims intake endpoints first.', createdAt: '15m ago' },
    { id: 'c-dev-2', workerId: 'w-dev', author: 'worker', content: 'On it — POST /claims and GET /claims/:id are in progress on feat/claims-intake-api.', createdAt: '14m ago' }
  ],
  'w-qa': [
    { id: 'c-qa-1', workerId: 'w-qa', author: 'worker', content: 'Verifying PR #12. Auth happy-path passes; testing token expiry now.', createdAt: '6m ago' }
  ],
  'w-git': [],
  'w-docs': [],
  'w-release': [
    { id: 'c-rel-1', workerId: 'w-release', author: 'worker', content: 'v0.3.0 is staged and waiting for your approval in the Approval Center.', createdAt: '8m ago' }
  ]
}

export function getChat(workerId: string): ChatMessage[] {
  return CHAT[workerId] ?? []
}

export function getWorkerById(id: string): Worker | undefined {
  return workers.find((w) => w.id === id)
}

export const approvals: ApprovalRequest[] = [
  { id: 'ap-1', title: 'Publish release v0.3.0', description: 'Release Manager is ready to tag and publish v0.3.0 of Company Landing Page.', kind: 'release', requestedBy: 'release', projectId: 'p-landing', risk: 'high', status: 'pending', createdAt: '8m ago' },
  { id: 'ap-2', title: 'Merge PR #12 into main', description: 'Auth flow test suite passed QA. Awaiting merge approval.', kind: 'merge', requestedBy: 'qa', projectId: 'p-landing', risk: 'medium', status: 'pending', createdAt: '14m ago' },
  { id: 'ap-3', title: 'Approve architecture for Claims Portal', description: 'CTO architecture and task breakdown ready for sign-off before engineering.', kind: 'architecture', requestedBy: 'cto', projectId: 'p-claims', risk: 'low', status: 'approved', createdAt: '2d ago' },
  { id: 'ap-4', title: 'Delete legacy reporting branch', description: 'Git Manager requested deletion of an obsolete branch.', kind: 'command', requestedBy: 'git', projectId: 'p-report', risk: 'high', status: 'rejected', createdAt: '3d ago' }
]

export const providers: ProviderOption[] = [
  { id: 'claude', label: 'Claude — Coding Engine', kind: 'coding', configured: true },
  { id: 'gpt', label: 'GPT — Planning Engine', kind: 'planning', configured: false },
  { id: 'native', label: 'Deterministic — No Model', kind: 'general', configured: true }
]

export const companySettings: CompanySettings = {
  companyName: 'SJ AI Company',
  autonomyLevel: 'supervised',
  providers,
  roleProviders: {
    cto: 'gpt',
    research: 'gpt',
    frontend: 'claude',
    backend: 'claude',
    developer: 'claude',
    qa: 'claude',
    git: 'native',
    documentation: 'claude',
    release: 'native'
  },
  policy: { architecture: true, merge: true, release: true, command: true }
}

export function providerForRole(
  role: WorkerRole,
  settings: CompanySettings = companySettings
): ProviderOption | undefined {
  return settings.providers.find((p) => p.id === settings.roleProviders[role])
}

export const activityLog: ActivityEvent[] = [
  { id: 'al-1', actor: 'developer', summary: 'Pushed 3 commits to feat/claims-intake-api', createdAt: 'just now' },
  { id: 'al-2', actor: 'developer', summary: 'Opened draft PR #14 — claims intake API', createdAt: '4m ago' },
  { id: 'al-3', actor: 'qa', summary: 'Started verifying PR #12 — auth flow test suite', createdAt: '6m ago' },
  { id: 'al-4', actor: 'release', summary: 'Requested CEO approval to publish v0.3.0', createdAt: '8m ago' },
  { id: 'al-5', actor: 'git', summary: 'Merged PR #11 into main', createdAt: '12m ago' },
  { id: 'al-6', actor: 'cto', summary: 'Completed task breakdown for Claims Portal', createdAt: '18m ago' },
  { id: 'al-7', actor: 'ceo', summary: 'Created project “Internal Reporting Tool”', createdAt: '31m ago' },
  { id: 'al-8', actor: 'documentation', summary: 'Updated README for Company Landing Page', createdAt: '44m ago' },
  { id: 'al-9', actor: 'cto', summary: 'Drafted architecture for Internal Reporting Tool', createdAt: '52m ago' },
  { id: 'al-10', actor: 'system', summary: 'AI company started — 6 workers online', createdAt: '1h ago' },
  { id: 'al-11', actor: 'ceo', summary: 'Approved architecture for Claims Portal', createdAt: '2d ago' },
  { id: 'al-12', actor: 'git', summary: 'Created repository sj-ai/claims-portal', createdAt: '2d ago' }
]
