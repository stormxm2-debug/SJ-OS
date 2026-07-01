import type { KernelEvent, KernelStateSnapshot, MeetingRole } from '@shared/kernel'

/**
 * Humanize Kernel events for the live activity feed and worker cards. Every
 * string here is derived from real Kernel state — no invented activity.
 */

const MEETING_ROLE_LABEL: Record<MeetingRole, string> = {
  chief_of_staff: 'Chief of Staff',
  cto: 'CTO',
  project_manager: 'Project Manager',
  research: 'Research',
  developer: 'Developer',
  qa: 'QA',
  git: 'Git Manager',
  release: 'Release Manager'
}

function taskTitle(snapshot: KernelStateSnapshot, taskId: string): string {
  return snapshot.tasks.find((t) => t.id === taskId)?.title ?? taskId
}

function workerName(snapshot: KernelStateSnapshot, workerId: string): string {
  return snapshot.workers.find((w) => w.id === workerId)?.metadata.displayName ?? workerId
}

export function describeEvent(event: KernelEvent, snapshot: KernelStateSnapshot): string {
  switch (event.type) {
    case 'MeetingCreated':
      return 'Kickoff meeting created'
    case 'MeetingOpinion':
      return `${MEETING_ROLE_LABEL[event.role]} — ${event.summary}`
    case 'MeetingPhaseChanged':
      return `Meeting → ${event.phase}`
    case 'MeetingConcluded':
      return event.approved ? 'Meeting approved the plan' : 'Meeting ended without approval'
    case 'ProjectCreated':
      return `Project “${event.name}” created`
    case 'TaskQueued':
      return `Queued: ${event.title}`
    case 'WorkerAssigned':
      return `${event.workerName} assigned “${taskTitle(snapshot, event.taskId)}”`
    case 'TaskStarted':
      return `${workerName(snapshot, event.workerId)} started “${taskTitle(snapshot, event.taskId)}”`
    case 'TaskProgress':
      return `${workerName(snapshot, event.workerId)} · ${event.progress}% on “${taskTitle(snapshot, event.taskId)}”`
    case 'TaskCompleted':
      return `${workerName(snapshot, event.workerId)} completed “${taskTitle(snapshot, event.taskId)}”`
    case 'WorkerFailed':
      return `${workerName(snapshot, event.workerId)} failed “${taskTitle(snapshot, event.taskId)}” — ${event.reason}`
    case 'ProjectCompleted':
      return event.succeeded ? 'Project completed' : 'Project ended with failures'
    case 'ApprovalRequested':
      return `Approval requested: ${event.title}`
    default:
      return ''
  }
}

/** A short "last event" line for a worker card, or null if none. */
export function lastEventForWorker(
  workerId: string,
  snapshot: KernelStateSnapshot
): string | null {
  for (let i = snapshot.events.length - 1; i >= 0; i -= 1) {
    const e = snapshot.events[i]
    if (
      (e.type === 'WorkerAssigned' ||
        e.type === 'TaskStarted' ||
        e.type === 'TaskCompleted' ||
        e.type === 'WorkerFailed') &&
      e.workerId === workerId
    ) {
      const title = taskTitle(snapshot, e.taskId)
      if (e.type === 'WorkerAssigned') return `Assigned “${title}”`
      if (e.type === 'TaskStarted') return `Started “${title}”`
      if (e.type === 'TaskCompleted') return `Completed “${title}”`
      return `Failed “${title}”`
    }
  }
  return null
}
