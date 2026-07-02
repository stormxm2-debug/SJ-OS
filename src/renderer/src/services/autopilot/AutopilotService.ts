import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { pmRepository } from '@renderer/services/pm/PmRepository'
import { ctoRepository } from '@renderer/services/cto/CtoRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import { qaRepository } from '@renderer/services/qa/QaRepository'
import { releaseRepository } from '@renderer/services/release/ReleaseRepository'
import { devOpsRepository } from '@renderer/services/devops/DevOpsRepository'
import { liveCompanyService } from '@renderer/services/live-company/LiveCompanyService'
import { implementationRepository } from '@renderer/services/implementation/ImplementationRepository'
import type { ImplementationRequest } from '@renderer/services/implementation/types'
import { loadState, saveState } from './autopilotPersistence'
import { autopilotSeed } from './seed'
import type {
  AutopilotActivityEntry,
  AutopilotState,
  AutopilotStepStatus,
  AutopilotTimelineEntry
} from './types'

/** The nine safe, local steps the operating loop walks, in order. */
interface StepDef {
  step: number
  title: string
  department: string
  /** DevOS worker id that owns this step (see DevOS seed roster). */
  workerId: string
}

const STEP_DEFS: StepDef[] = [
  { step: 1, title: 'Check Approval Center', department: 'Approval Center', workerId: 'ceo' },
  { step: 2, title: 'Check PM Planner next task', department: 'PM Planner', workerId: 'pm' },
  { step: 3, title: 'Promote task to Development OS', department: 'Development OS', workerId: 'architect' },
  { step: 4, title: 'Update Worker Memory', department: 'Development OS', workerId: 'jarvis' },
  { step: 5, title: 'Summarize CTO risks', department: 'CTO Room', workerId: 'cto' },
  { step: 6, title: 'Check QA readiness', department: 'QA Center', workerId: 'qa' },
  { step: 7, title: 'Check Release readiness', department: 'Release Center', workerId: 'devops' },
  { step: 8, title: 'Check DevOps readiness', department: 'DevOps Center', workerId: 'devops' },
  { step: 9, title: 'Update Live Company snapshot', department: 'Live Company', workerId: 'jarvis' }
]

const TOTAL_STEPS = STEP_DEFS.length
const MAX_ACTIVITY = 40

/** Workers whose memory the loop refreshes in step 4. */
const MEMORY_WORKER_IDS = ['pm', 'cto', 'qa', 'devops', 'jarvis']

/** How one executed step affects the loop. */
interface StepOutcome {
  detail: string
  gate: 'proceed' | 'wait-approval' | 'blocked'
  action: string
  blockers: string[]
  warnings: string[]
}

function cloneSeed(): AutopilotState {
  return JSON.parse(JSON.stringify(autopilotSeed)) as AutopilotState
}

function progressFor(step: number): number {
  return Math.max(0, Math.min(100, Math.round((step / TOTAL_STEPS) * 100)))
}

/**
 * Autopilot — the AI Company Operating Loop.
 *
 * A single, safe, local orchestrator over every SJ OS module. It reads the
 * Approval Center, PM Planner, CTO Room, QA / Release / DevOps Centers and the
 * Development OS, and drives them only through their existing public APIs. It
 * owns its own persisted run state and exposes a pub/sub shape (mirroring the
 * other services) so a React hook can bind with useSyncExternalStore.
 *
 * The loop never calls an external API, never touches a database, never runs a
 * real deployment and never executes a Git command. Every step is a local
 * read / summarise / promote.
 */
export class AutopilotService {
  private state: AutopilotState
  private listeners = new Set<() => void>()
  private seq = 0

  constructor() {
    this.state = loadState() ?? cloneSeed()
  }

  getSnapshot(): AutopilotState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Pretty-printed JSON of the current run, for the Export report action. */
  serializeReport(): string {
    return JSON.stringify(this.state, null, 2)
  }

  // --- Jarvis implementation-request visibility ----------------------------
  // Thin read-through views so a future operating-loop step can act on the
  // Jarvis implementation queue without a deep Autopilot redesign this sprint.

  /** Implementation requests still working through planning / approval. */
  getPendingImplementationRequests(): ImplementationRequest[] {
    return implementationRepository.getPendingRequests()
  }

  /** Implementation requests explicitly approved and awaiting promotion. */
  getApprovedImplementationRequests(): ImplementationRequest[] {
    return implementationRepository.getApprovedRequests()
  }

  /** The single next implementation request Autopilot should promote (or null). */
  getNextImplementationRequestToPromote(): ImplementationRequest | null {
    return implementationRepository.getNextToPromote()
  }

  // --- internal state plumbing ---------------------------------------------

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private nameOf(workerId: string): string {
    if (workerId === 'ceo') return 'CEO'
    return devOsRepository.getWorker(workerId)?.name ?? workerId
  }

  private commit(next: AutopilotState): void {
    this.state = { ...next, updatedAt: new Date().toISOString() }
    saveState(this.state)
    this.listeners.forEach((listener) => listener())
  }

  private withActivity(state: AutopilotState, message: string): AutopilotActivityEntry[] {
    const entry: AutopilotActivityEntry = {
      id: this.nextId('apact'),
      message,
      createdAt: new Date().toISOString()
    }
    return [entry, ...state.activity].slice(0, MAX_ACTIVITY)
  }

  private freshTimeline(): AutopilotTimelineEntry[] {
    const now = new Date().toISOString()
    return STEP_DEFS.map((def) => ({
      step: def.step,
      title: def.title,
      department: def.department,
      status: 'pending' as AutopilotStepStatus,
      detail: '',
      updatedAt: now
    }))
  }

  private markStep(
    timeline: AutopilotTimelineEntry[],
    step: number,
    status: AutopilotStepStatus,
    detail: string
  ): AutopilotTimelineEntry[] {
    return timeline.map((entry) =>
      entry.step === step
        ? { ...entry, status, detail, updatedAt: new Date().toISOString() }
        : entry
    )
  }

  // --- controls ------------------------------------------------------------

  /** Start Company — begin a fresh operating-loop run and take the first step. */
  start(): void {
    const now = new Date().toISOString()
    const base: AutopilotState = {
      ...cloneSeed(),
      autopilotRunId: this.nextId('run'),
      status: 'running',
      currentStep: 0,
      currentDepartment: 'Autopilot',
      currentWorker: '—',
      currentAction: 'Operating loop started.',
      progress: 0,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      blockers: [],
      warnings: [],
      nextAction: 'Run the first loop step.',
      lastResult: 'Operating loop started.',
      timeline: this.freshTimeline(),
      activity: []
    }
    base.activity = this.withActivity(base, 'Start Company — operating loop started')
    this.commit(base)
    // Immediately take the first step so the company visibly moves.
    this.runStep()
  }

  /**
   * Run one loop step. Advances to the next step when running; when the loop is
   * held at a gate (waiting-for-approval / blocked) it re-evaluates that gate in
   * place, so clearing the underlying issue lets the next run continue.
   */
  runStep(): void {
    const state = this.state
    if (state.status === 'idle' || state.status === 'completed' || state.status === 'failed') {
      return
    }
    if (state.status === 'paused') return

    const holdingGate =
      state.status === 'waiting-for-approval' || state.status === 'blocked'
    const target = holdingGate ? Math.max(1, state.currentStep) : state.currentStep + 1

    if (target > TOTAL_STEPS) {
      this.finalize()
      return
    }

    const def = STEP_DEFS[target - 1]
    const outcome = this.executeStep(target)
    const workerName = this.nameOf(def.workerId)
    const now = new Date().toISOString()

    const warnings = dedupe([...state.warnings, ...outcome.warnings])

    if (outcome.gate === 'wait-approval' || outcome.gate === 'blocked') {
      const status = outcome.gate === 'wait-approval' ? 'waiting-for-approval' : 'blocked'
      this.commit({
        ...state,
        status,
        currentStep: target,
        currentDepartment: def.department,
        currentWorker: workerName,
        currentAction: outcome.action,
        progress: progressFor(target - 1),
        blockers: dedupe([...state.blockers, ...outcome.blockers]),
        warnings,
        nextAction: outcome.action,
        lastResult: outcome.detail,
        timeline: this.markStep(state.timeline, target, 'blocked', outcome.detail),
        activity: this.withActivity(state, `Step ${target} · ${def.title}: ${outcome.detail}`)
      })
      return
    }

    // Step proceeded.
    const advanced: AutopilotState = {
      ...state,
      status: 'running',
      currentStep: target,
      currentDepartment: def.department,
      currentWorker: workerName,
      currentAction: outcome.action,
      progress: progressFor(target),
      warnings,
      nextAction: outcome.action,
      lastResult: outcome.detail,
      timeline: this.markStep(state.timeline, target, 'done', outcome.detail),
      activity: this.withActivity(state, `Step ${target} · ${def.title}: ${outcome.detail}`),
      updatedAt: now
    }

    if (target === TOTAL_STEPS) {
      this.commit(advanced)
      this.finalize()
      return
    }
    this.commit(advanced)
  }

  /** Pause the running loop. */
  pause(): void {
    const state = this.state
    if (
      state.status !== 'running' &&
      state.status !== 'waiting-for-approval' &&
      state.status !== 'blocked'
    ) {
      return
    }
    this.commit({
      ...state,
      status: 'paused',
      currentAction: 'Operating loop paused by the CEO.',
      activity: this.withActivity(state, 'Autopilot paused')
    })
  }

  /** Resume a paused loop. */
  resume(): void {
    const state = this.state
    if (state.status !== 'paused') return
    this.commit({
      ...state,
      status: 'running',
      currentAction: 'Operating loop resumed.',
      activity: this.withActivity(state, 'Autopilot resumed')
    })
  }

  /** Stop the loop and return Autopilot to idle, keeping the run history. */
  stop(): void {
    const state = this.state
    if (state.status === 'idle') return
    this.commit({
      ...state,
      status: 'idle',
      currentAction: 'Operating loop stopped.',
      nextAction: 'Press Start Company to begin a new run.',
      lastResult: `Stopped at step ${state.currentStep}/${TOTAL_STEPS}.`,
      activity: this.withActivity(state, 'Autopilot stopped')
    })
  }

  /** Clear the current autopilot blocker so the loop can continue. */
  clearBlocker(): void {
    const state = this.state
    if (state.blockers.length === 0 && state.status !== 'blocked' && state.status !== 'waiting-for-approval') {
      return
    }
    const resume = state.status === 'blocked' || state.status === 'waiting-for-approval'
    this.commit({
      ...state,
      status: resume ? 'running' : state.status,
      blockers: [],
      currentAction: 'Blocker cleared — loop ready to continue.',
      lastResult: 'Autopilot blocker cleared.',
      activity: this.withActivity(state, 'Autopilot blocker cleared')
    })
  }

  /** Reset autopilot demo state (this run only — other modules are untouched). */
  resetDemoState(): void {
    const fresh = cloneSeed()
    fresh.activity = this.withActivity(fresh, 'Autopilot demo state reset')
    this.commit(fresh)
  }

  // --- loop steps ----------------------------------------------------------

  private finalize(): void {
    const state = this.state
    const now = new Date().toISOString()
    this.commit({
      ...state,
      status: 'completed',
      progress: 100,
      currentStep: TOTAL_STEPS,
      completedAt: now,
      currentAction: 'Operating loop complete — company snapshot up to date.',
      nextAction: liveCompanyService.getSnapshot().nextRecommendedAction,
      lastResult: 'Operating loop completed all nine steps.',
      activity: this.withActivity(state, 'Operating loop completed')
    })
  }

  /** Execute one safe, local step and report how it affects the loop. */
  private executeStep(step: number): StepOutcome {
    switch (step) {
      case 1:
        return this.stepCheckApprovals()
      case 2:
        return this.stepCheckPmNext()
      case 3:
        return this.stepPromoteToDevOs()
      case 4:
        return this.stepUpdateWorkerMemory()
      case 5:
        return this.stepSummarizeCto()
      case 6:
        return this.stepCheckQa()
      case 7:
        return this.stepCheckRelease()
      case 8:
        return this.stepCheckDevOps()
      case 9:
        return this.stepUpdateLiveCompany()
      default:
        return { detail: 'No-op.', gate: 'proceed', action: '', blockers: [], warnings: [] }
    }
  }

  /** Step 1 — high-priority pending approvals hold the loop for CEO sign-off. */
  private stepCheckApprovals(): StepOutcome {
    const approvals = approvalRepository.listApprovals()
    const pending = approvals.filter((a) => a.status === 'pending')
    const highPriority = pending.filter((a) => a.priority === 'P0' || a.priority === 'P1')
    if (highPriority.length > 0) {
      return {
        detail: `${highPriority.length} high-priority approval(s) awaiting CEO sign-off.`,
        gate: 'wait-approval',
        action: `Review ${highPriority.length} high-priority approval(s) in the Approval Center.`,
        blockers: [`${highPriority.length} high-priority approval(s) pending`],
        warnings: []
      }
    }
    const warnings =
      pending.length > 0 ? [`${pending.length} non-blocking approval(s) pending`] : []
    return {
      detail:
        pending.length > 0
          ? `Approvals clear of blockers (${pending.length} low-priority pending).`
          : 'No pending approvals — clear to proceed.',
      gate: 'proceed',
      action: 'Approvals clear — check the PM Planner next.',
      blockers: [],
      warnings
    }
  }

  /** Step 2 — pick the next active feature from the PM Planner. */
  private stepCheckPmNext(): StepOutcome {
    const feature = this.pickNextFeature()
    if (!feature) {
      const blockedTasks = pmRepository.listTasks().filter((t) => t.status === 'blocked').length
      if (blockedTasks > 0) {
        return {
          detail: `No promotable feature — ${blockedTasks} PM task(s) blocked.`,
          gate: 'blocked',
          action: `Unblock ${blockedTasks} PM task(s) so the loop can proceed.`,
          blockers: [`${blockedTasks} blocked PM task(s)`],
          warnings: []
        }
      }
      return {
        detail: 'No active feature in the PM Planner — nothing to promote.',
        gate: 'proceed',
        action: 'Plan a feature in the PM Planner to give the loop work.',
        blockers: [],
        warnings: ['PM Planner has no active feature to promote']
      }
    }
    return {
      detail: `Next feature selected: ${feature.title}.`,
      gate: 'proceed',
      action: `Promote "${feature.title}" into the Development OS.`,
      blockers: [],
      warnings: []
    }
  }

  /** Step 3 — promote the selected feature to the active DevOS session. */
  private stepPromoteToDevOs(): StepOutcome {
    const feature = this.pickNextFeature()
    if (!feature) {
      const session = devOsRepository.getSession()
      return {
        detail: `Kept current DevOS work: ${session.currentFeature}.`,
        gate: 'proceed',
        action: 'Continue the current Development OS session.',
        blockers: [],
        warnings: []
      }
    }
    const result = pmRepository.promoteFeatureToActive(feature.id)
    if (!result.success) {
      return {
        detail: `Could not promote feature: ${result.error ?? 'unknown error'}.`,
        gate: 'proceed',
        action: 'Continue the current Development OS session.',
        blockers: [],
        warnings: [`Promotion skipped: ${result.error ?? 'unknown error'}`]
      }
    }
    return {
      detail: `Promoted "${feature.title}" to the active Development OS session.`,
      gate: 'proceed',
      action: `Advance feature: ${feature.title}.`,
      blockers: [],
      warnings: []
    }
  }

  /** Step 4 — refresh Worker Memory for the core company workers. */
  private stepUpdateWorkerMemory(): StepOutcome {
    const refreshed: string[] = []
    for (const workerId of MEMORY_WORKER_IDS) {
      const result = devOsRepository.touchWorker(workerId)
      if (result.success && result.data) refreshed.push(result.data.name)
    }
    return {
      detail:
        refreshed.length > 0
          ? `Refreshed Worker Memory for ${refreshed.join(', ')}.`
          : 'No workers to refresh.',
      gate: 'proceed',
      action: 'Summarize CTO risks and technical debt.',
      blockers: [],
      warnings: []
    }
  }

  /** Step 5 — summarise CTO Room risks and technical debt. */
  private stepSummarizeCto(): StepOutcome {
    const cto = ctoRepository.getSnapshot()
    const openRisks = cto.riskItems.filter((r) => r.status === 'open').length
    const openDebt = cto.technicalDebtItems.filter((d) => d.status === 'open').length
    const blockedDecisions = cto.blockedDecisions.filter((d) => d.status === 'blocked').length
    const warnings: string[] = []
    if (openRisks > 0) warnings.push(`${openRisks} open CTO risk(s)`)
    if (openDebt > 0) warnings.push(`${openDebt} open technical-debt item(s)`)
    if (blockedDecisions > 0) warnings.push(`${blockedDecisions} blocked CTO decision(s)`)
    return {
      detail: `CTO health ${cto.architectureHealth.score}/100 · ${openRisks} risk(s), ${openDebt} debt item(s).`,
      gate: 'proceed',
      action: 'Check QA readiness.',
      blockers: [],
      warnings
    }
  }

  /** Step 6 — check QA readiness (warnings & release blockers). */
  private stepCheckQa(): StepOutcome {
    const latest = qaRepository.getSnapshot().runs[0] ?? null
    if (!latest) {
      return {
        detail: 'No QA runs recorded yet.',
        gate: 'proceed',
        action: 'Check Release readiness.',
        blockers: [],
        warnings: ['QA Center has no runs']
      }
    }
    const warnings: string[] = []
    if (latest.releaseBlockers.length > 0) {
      warnings.push(`${latest.releaseBlockers.length} QA release blocker(s)`)
    }
    if (latest.warnings.length > 0) warnings.push(`${latest.warnings.length} QA warning(s)`)
    return {
      detail: `Latest QA run "${latest.title}" is ${latest.status} (${latest.passedChecks.length} passed, ${latest.failedChecks.length} failed).`,
      gate: 'proceed',
      action: 'Check Release readiness.',
      blockers: [],
      warnings
    }
  }

  /** Step 7 — check Release Center readiness. */
  private stepCheckRelease(): StepOutcome {
    const release = releaseRepository.getSnapshot().releases[0] ?? null
    if (!release) {
      return {
        detail: 'No release candidate prepared yet.',
        gate: 'proceed',
        action: 'Check DevOps readiness.',
        blockers: [],
        warnings: ['Release Center has no candidate']
      }
    }
    const warnings =
      release.blockers.length > 0 ? [`${release.blockers.length} release blocker(s)`] : []
    return {
      detail: `Release "${release.version}" is ${release.status} (build ${release.buildStatus}, QA ${release.qaStatus}).`,
      gate: 'proceed',
      action: 'Check DevOps readiness.',
      blockers: [],
      warnings
    }
  }

  /** Step 8 — check DevOps Center readiness (no real deployment). */
  private stepCheckDevOps(): StepOutcome {
    const deployment = devOpsRepository.getSnapshot().deployments[0] ?? null
    if (!deployment) {
      return {
        detail: 'No deployment candidate prepared yet.',
        gate: 'proceed',
        action: 'Update the Live Company snapshot.',
        blockers: [],
        warnings: ['DevOps Center has no deployment']
      }
    }
    const warnings =
      deployment.blockers.length > 0 ? [`${deployment.blockers.length} deployment blocker(s)`] : []
    return {
      detail: `Deployment "${deployment.version}" to ${deployment.environment} is ${deployment.status} (health ${deployment.healthStatus}).`,
      gate: 'proceed',
      action: 'Update the Live Company snapshot.',
      blockers: [],
      warnings
    }
  }

  /** Step 9 — recompute the Live Company snapshot and close the loop. */
  private stepUpdateLiveCompany(): StepOutcome {
    liveCompanyService.refresh()
    const snapshot = liveCompanyService.getSnapshot()
    return {
      detail: `Live Company snapshot updated — company is "${snapshot.companyStatus}" at ${snapshot.overallProgress}%.`,
      gate: 'proceed',
      action: snapshot.nextRecommendedAction,
      blockers: [],
      warnings: []
    }
  }

  /** Prefer an in-progress feature, else the first planned one, else none. */
  private pickNextFeature(): { id: string; title: string } | null {
    const features = pmRepository.listFeatures()
    const inProgress = features.find((f) => f.status === 'in_progress')
    if (inProgress) return { id: inProgress.id, title: inProgress.title }
    const planned = features.find((f) => f.status === 'planned')
    if (planned) return { id: planned.id, title: planned.title }
    return null
  }
}

/** Drop duplicate strings while keeping first-seen order. */
function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

export const autopilotService = new AutopilotService()
