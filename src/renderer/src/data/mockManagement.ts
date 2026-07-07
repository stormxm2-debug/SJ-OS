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

const MEMORY: Record<string, MemoryEntry[]> = {}

export function getMemory(workerId: string): MemoryEntry[] {
  return MEMORY[workerId] ?? []
}

const CHAT: Record<string, ChatMessage[]> = {}

export function getChat(workerId: string): ChatMessage[] {
  return CHAT[workerId] ?? []
}

export function getWorkerById(id: string): Worker | undefined {
  return workers.find((w) => w.id === id)
}

export const approvals: ApprovalRequest[] = []

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

export const activityLog: ActivityEvent[] = []
