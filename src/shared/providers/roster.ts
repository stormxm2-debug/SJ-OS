import type { WorkerRole } from '../types'
import type { Worker } from '../kernel'
import { ProviderBackedWorker } from './ProviderBackedWorker'
import { ClaudeCodeProvider } from './ClaudeCodeProvider'
import { MockCodingProvider } from './mockCodingProvider'
import type { CodingExecutionBackend } from './backend'
import type { CodingProvider } from './adapter'

/**
 * The company worker roster used to boot the Kernel.
 *
 * Every worker is provider-backed: when a real coding backend is available
 * (Electron main process, over IPC) each role runs a `ClaudeCodeProvider` and
 * produces REAL files; otherwise each falls back to a clearly-marked
 * `MockCodingProvider`. This is the single wiring point — the Kernel only ever
 * sees a `Worker`.
 */
const ROSTER: { role: WorkerRole; id: string; displayName: string }[] = [
  { role: 'research', id: 'worker-research', displayName: 'Research Engineer' },
  { role: 'cto', id: 'worker-cto', displayName: 'CTO Agent' },
  { role: 'backend', id: 'worker-backend', displayName: 'Backend Engineer' },
  { role: 'frontend', id: 'worker-frontend', displayName: 'Frontend Engineer' },
  { role: 'developer', id: 'worker-developer', displayName: 'Developer Agent' },
  { role: 'qa', id: 'worker-qa', displayName: 'QA Agent' },
  { role: 'git', id: 'worker-git', displayName: 'Git Manager Agent' },
  { role: 'documentation', id: 'worker-documentation', displayName: 'Documentation Agent' },
  { role: 'release', id: 'worker-release', displayName: 'Release Agent' }
]

export function createCompanyWorkers(backend?: CodingExecutionBackend): Worker[] {
  const makeProvider = (role: WorkerRole): CodingProvider =>
    backend
      ? new ClaudeCodeProvider(backend, { id: `claude-${role}` })
      : new MockCodingProvider({ id: `mock-${role}` })

  return ROSTER.map(
    (w) =>
      new ProviderBackedWorker({
        id: w.id,
        role: w.role,
        displayName: w.displayName,
        provider: makeProvider(w.role)
      })
  )
}
