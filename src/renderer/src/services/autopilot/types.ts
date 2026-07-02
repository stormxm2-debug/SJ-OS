/**
 * Autopilot — the AI Company Operating Loop types.
 *
 * SJ OS runs a single, safe, local operating loop that walks the whole company
 * — Approval Center → PM Planner → Development OS → Worker Memory → CTO Room →
 * QA Center → Release Center → DevOps Center → Live Company — one step at a
 * time. Autopilot owns no domain data of its own; it reads each module and
 * drives it through that module's existing public API. Its only persisted state
 * is the run itself (status, step, blockers, timeline, activity).
 *
 * No external API, no database, no real deployment, no Git commands. Every step
 * is a safe local read/summarise/promote using the same repositories the CEO
 * command center already uses.
 */

/** Where the operating loop stands. */
export type AutopilotStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'waiting-for-approval'
  | 'completed'
  | 'failed'

/** Status of a single step in the operating-loop timeline. */
export type AutopilotStepStatus = 'pending' | 'active' | 'done' | 'blocked' | 'skipped'

/** One step in the nine-step operating-loop timeline. */
export interface AutopilotTimelineEntry {
  /** 1-based step number (1–9). */
  step: number
  title: string
  department: string
  status: AutopilotStepStatus
  detail: string
  updatedAt: string
}

/** A single, newest-first entry in the Autopilot activity log. */
export interface AutopilotActivityEntry {
  id: string
  message: string
  createdAt: string
}

/**
 * The full persisted Autopilot state. Tracks the current run end to end so the
 * loop survives a reload and the CEO can see exactly where the company is.
 */
export interface AutopilotState {
  /** Id of the current run; null before the first Start Company. */
  autopilotRunId: string | null
  status: AutopilotStatus
  /** 0 before the first step; 1–9 while walking the loop. */
  currentStep: number
  currentDepartment: string
  currentWorker: string
  currentAction: string
  /** 0–100 across the nine loop steps. */
  progress: number
  startedAt: string | null
  updatedAt: string
  completedAt: string | null
  /** Hard blockers that hold the loop (approvals, blocked work). */
  blockers: string[]
  /** Non-blocking issues surfaced by CTO / QA / Release / DevOps. */
  warnings: string[]
  /** The next concrete action the company should take. */
  nextAction: string
  /** Human-readable result of the last executed step. */
  lastResult: string
  /** The nine-step operating-loop timeline for the current run. */
  timeline: AutopilotTimelineEntry[]
  /** Newest-first activity log for the current run. */
  activity: AutopilotActivityEntry[]
}
