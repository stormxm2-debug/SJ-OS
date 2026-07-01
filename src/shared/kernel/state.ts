import type { KernelEvent } from './events'
import type { AssetRecord } from './asset'
import type { Department } from './department'
import type { Meeting } from './meeting'
import type {
  Assignment,
  BuildStatus,
  KernelProject,
  KernelTask,
  KernelWorkerRecord,
  ProjectArtifact,
  ProjectState,
  TaskState
} from './types'

/**
 * Kernel State — the single source of truth for Projects, Tasks and
 * Assignments. (Workers live in the Worker Registry and Events in the Event
 * Bus; the Kernel composes all of them into one immutable snapshot for
 * observers.) No worker owns any of this. Only the Kernel mutates it, through
 * these narrow methods; everyone else reads immutable copies.
 */
export class KernelState {
  private readonly projectsById = new Map<string, KernelProject>()
  private readonly tasksById = new Map<string, KernelTask>()
  private readonly assignmentsList: Assignment[] = []
  private readonly meetingsById = new Map<string, Meeting>()
  private readonly artifactsList: ProjectArtifact[] = []
  private readonly artifactKeys = new Set<string>()

  // ---- Artifacts (real files produced by execution) ------------------------

  addArtifact(artifact: ProjectArtifact): boolean {
    const key = `${artifact.projectId}:${artifact.path}`
    if (this.artifactKeys.has(key)) return false
    this.artifactKeys.add(key)
    this.artifactsList.push({ ...artifact })
    return true
  }

  artifacts(): ProjectArtifact[] {
    return this.artifactsList.map((a) => ({ ...a }))
  }

  // ---- Meetings ------------------------------------------------------------

  addMeeting(meeting: Meeting): void {
    this.meetingsById.set(meeting.id, cloneMeeting(meeting))
  }

  updateMeeting(id: string, patch: Partial<Meeting>): void {
    const m = this.meetingsById.get(id)
    if (!m) return
    Object.assign(m, patch)
  }

  getMeeting(id: string): Meeting | undefined {
    const m = this.meetingsById.get(id)
    return m ? cloneMeeting(m) : undefined
  }

  meetings(): Meeting[] {
    return [...this.meetingsById.values()].map(cloneMeeting)
  }

  // ---- Projects ------------------------------------------------------------

  addProject(project: KernelProject): void {
    this.projectsById.set(project.id, { ...project })
  }

  setProjectState(id: string, state: ProjectState): void {
    const p = this.projectsById.get(id)
    if (p) p.state = state
  }

  setProjectBuildStatus(id: string, buildStatus: BuildStatus): void {
    const p = this.projectsById.get(id)
    if (p) p.buildStatus = buildStatus
  }

  setProjectWorkspace(id: string, workspace: string): void {
    const p = this.projectsById.get(id)
    if (p && !p.workspace) p.workspace = workspace
  }

  getProject(id: string): KernelProject | undefined {
    const p = this.projectsById.get(id)
    return p ? { ...p } : undefined
  }

  projects(): KernelProject[] {
    return [...this.projectsById.values()].map((p) => ({ ...p }))
  }

  // ---- Tasks ---------------------------------------------------------------

  addTask(task: KernelTask): void {
    this.tasksById.set(task.id, { ...task, dependsOn: [...task.dependsOn] })
  }

  updateTask(id: string, patch: Partial<KernelTask>): void {
    const t = this.tasksById.get(id)
    if (!t) return
    Object.assign(t, patch)
  }

  getTask(id: string): KernelTask | undefined {
    const t = this.tasksById.get(id)
    return t ? cloneTask(t) : undefined
  }

  tasks(): KernelTask[] {
    return [...this.tasksById.values()].map(cloneTask)
  }

  tasksForProject(projectId: string): KernelTask[] {
    return this.tasks().filter((t) => t.projectId === projectId)
  }

  /** True when every task of a project is in a terminal state. */
  isProjectSettled(projectId: string): boolean {
    const tasks = this.tasksForProject(projectId)
    return tasks.length > 0 && tasks.every((t) => isTerminal(t.state))
  }

  // ---- Assignments ---------------------------------------------------------

  addAssignment(assignment: Assignment): void {
    this.assignmentsList.push({ ...assignment })
  }

  assignments(): Assignment[] {
    return this.assignmentsList.map((a) => ({ ...a }))
  }

  // ---- Lifecycle -----------------------------------------------------------

  clear(): void {
    this.projectsById.clear()
    this.tasksById.clear()
    this.assignmentsList.length = 0
    this.meetingsById.clear()
    this.artifactsList.length = 0
    this.artifactKeys.clear()
  }
}

export interface KernelStateSnapshot {
  meetings: Meeting[]
  departments: Department[]
  projects: KernelProject[]
  tasks: KernelTask[]
  workers: KernelWorkerRecord[]
  assignments: Assignment[]
  artifacts: ProjectArtifact[]
  assets: AssetRecord[]
  events: readonly KernelEvent[]
}

function cloneMeeting(m: Meeting): Meeting {
  return {
    ...m,
    participants: [...m.participants],
    opinions: m.opinions.map((o) => ({
      ...o,
      concerns: [...o.concerns]
    })),
    decision: m.decision
      ? {
          ...m.decision,
          risks: [...m.decision.risks],
          alternatives: [...m.decision.alternatives],
          requiredCapabilities: [...m.decision.requiredCapabilities]
        }
      : null
  }
}

export function isTerminal(state: TaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'blocked'
}

function cloneTask(t: KernelTask): KernelTask {
  return { ...t, dependsOn: [...t.dependsOn] }
}
