export type CompanyStartupStatus = 'idle' | 'running' | 'ready' | 'failed'

export type StartupStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface CompanyStartupStep {
  id: string
  label: string
  status: StartupStepStatus
  detail?: string
}

export interface CompanyStartupBacklogSnapshot {
  currentRelease: string
  currentSprint: string
  nextPriority: string
  todaysObjectives: string[]
  activeWorkers: number
}

export interface CompanyStartupSnapshot {
  isRunning: boolean
  status: CompanyStartupStatus
  startedAt: number | null
  completedAt: number | null
  durationMs: number | null
  activeStep: string | null
  steps: CompanyStartupStep[]
  error: string | null
  companyStatus: string
  currentRelease: string
  currentSprint: string
  nextPriority: string
  activeWorkers: number
  todaysObjectives: string[]
}

export function createStartupSteps(): CompanyStartupStep[] {
  return [
    { id: 'initializing_repository', label: 'Initializing Repository...', status: 'pending' },
    { id: 'checking_node', label: 'Checking Node.js...', status: 'pending' },
    { id: 'checking_dependencies', label: 'Checking Dependencies...', status: 'pending' },
    { id: 'typechecking', label: 'Typechecking...', status: 'pending' },
    { id: 'building', label: 'Building...', status: 'pending' },
    { id: 'launching_electron', label: 'Launching Electron...', status: 'pending' },
    { id: 'connecting_workers', label: 'Connecting AI Workers...', status: 'pending' },
    { id: 'reading_backlog', label: 'Reading Product Backlog...', status: 'pending' },
    { id: 'generating_briefing', label: 'Generating Executive Briefing...', status: 'pending' },
    { id: 'company_ready', label: 'Company Ready', status: 'pending' }
  ]
}

export function createInitialStartupState(): CompanyStartupSnapshot {
  return {
    isRunning: false,
    status: 'idle',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    activeStep: null,
    steps: createStartupSteps(),
    error: null,
    companyStatus: 'Sleeping',
    currentRelease: 'Release 1',
    currentSprint: 'Sprint 1',
    nextPriority: 'Customer Journey',
    activeWorkers: 0,
    todaysObjectives: ['Review priorities', 'Keep the company healthy']
  }
}

export interface ExecutiveBriefing {
  headline: string
  objectives: string[]
}

export function buildExecutiveBriefing(
  backlog: CompanyStartupBacklogSnapshot,
  activeWorkers: number
): ExecutiveBriefing {
  const headline = backlog.nextPriority || 'Customer Journey'
  const objectives = [
    `Keep ${activeWorkers} AI workers aligned on ${backlog.currentRelease}`,
    `Advance ${headline} through ${backlog.currentSprint}`,
    ...backlog.todaysObjectives.slice(0, 2)
  ]

  return {
    headline,
    objectives: objectives.slice(0, 3)
  }
}

export function parseNodeVersion(version: string): [number, number, number] {
  const match = version.match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return [0, 0, 0]
  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

export function isNodeVersionSupported(version: string): boolean {
  const [major, minor] = parseNodeVersion(version)
  return major > 18 || (major === 18 && minor >= 17)
}
