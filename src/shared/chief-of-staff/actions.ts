import type {
  CeoRequest,
  CeoStatusReport,
  Classification,
  Project,
  ProgressSnapshot,
  WorkBreakdown,
  WorkQueue,
  Assignment
} from './types'

/**
 * The Chief of Staff's ACTION INTERFACES — its planning brains.
 *
 * After the Company Kernel (Sprint 2), the Chief of Staff performs only the
 * PLANNING actions: understand the request, size it, break it down, sequence
 * it, and narrate the result. It NO LONGER assigns, dispatches, or tracks
 * workers — those responsibilities moved into the Kernel, which the Chief of
 * Staff drives through the Kernel's public API. It never touches a worker.
 *
 * Each interface stays async + plain-data so a real backend (OpenAI/Claude for
 * classification, planning and reporting) can replace a mock with no change to
 * the Chief of Staff.
 */

/** Cancellation + logging handed to every action. */
export interface ActionContext {
  readonly signal: AbortSignal
  log(message: string): void
}

/** Classify the request and estimate its size (capabilities 3 + 4). */
export interface RequestClassifier {
  classify(request: CeoRequest, ctx: ActionContext): Promise<Classification>
}

/** Break the project into Epic → Features → Tasks → Subtasks (capability 5). */
export interface TaskPlanner {
  plan(
    project: Project,
    classification: Classification,
    ctx: ActionContext
  ): Promise<WorkBreakdown>
}

/** Turn the breakdown into an ordered, dependency-aware queue (capability 6). */
export interface WorkQueueBuilder {
  build(breakdown: WorkBreakdown, ctx: ActionContext): Promise<WorkQueue>
}

/** Generate the CEO status report (capability 9). */
export interface StatusReporter {
  report(input: StatusReportInput, ctx: ActionContext): Promise<CeoStatusReport>
}

export interface StatusReportInput {
  project: Project
  classification: Classification
  breakdown: WorkBreakdown
  queue: WorkQueue
  assignments: Assignment[]
  progress: ProgressSnapshot
}
