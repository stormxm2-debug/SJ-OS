import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { pmRepository } from '@renderer/services/pm/PmRepository'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import { UniversalBuilderEvents, type UniversalBuilderEventName } from './UniversalBuilderEvents'
import { UniversalBuilderState } from './UniversalBuilderState'
import { universalBuilderSeed } from './seed'
import { classifyAppType } from './appTypeClassifier'
import { buildPlan, buildSprintPlan, interpretGoal } from './planningEngine'
import { planTools } from './toolOrchestrationPlanner'
import { generateDeveloperPrompt, type PromptSource } from './developerPromptGenerator'
import type {
  NewUniversalBuildInput,
  UniversalBuildLogEntry,
  UniversalBuildLogType,
  UniversalBuildProject,
  UniversalBuildStatus,
  UniversalBuilderSnapshot,
  UniversalBuilderSummary
} from './types'

export interface UniversalBuilderOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 80

function cloneSeed(): UniversalBuilderSnapshot {
  return JSON.parse(JSON.stringify(universalBuilderSeed)) as UniversalBuilderSnapshot
}

/** Statuses that still need work before development can begin. */
const PENDING_STATUSES = new Set<UniversalBuildStatus>([
  'captured',
  'interpreted',
  'planned',
  'needs-approval'
])

/**
 * Repository over the Universal App Builder queue. Same shape as the other SJ OS
 * repositories: a state holder + event bus, mutations return a result and
 * persist through UniversalBuilderState.
 *
 * This is the safety layer that lets Jarvis turn a CEO "build me a system"
 * command into a structured, locally-planned build project WITHOUT editing
 * source files, running git, or calling external APIs. A command becomes a
 * planned project (modules, screens, data models, AI-tool orchestration plan,
 * Claude Code-ready prompt), routed into the existing development operating
 * system: a PM Planner backlog item is created, an Approval Center request is
 * raised when approval is required, and a Development OS event is recorded.
 */
export class UniversalBuilderRepository {
  private seq = 0

  constructor(
    private readonly state = new UniversalBuilderState(),
    private readonly events = new UniversalBuilderEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): UniversalBuilderSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: UniversalBuilderEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: UniversalBuildLogType, message: string): UniversalBuildLogEntry {
    return { id: this.nextId('ubevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: UniversalBuilderSnapshot,
    type: UniversalBuildLogType,
    message: string
  ): UniversalBuilderSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: UniversalBuilderSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listProjects(): UniversalBuildProject[] {
    return this.state.getSnapshot().projects
  }

  getProject(projectId: string): UniversalBuildProject | null {
    return this.state.getSnapshot().projects.find((p) => p.id === projectId) ?? null
  }

  getSelectedProject(): UniversalBuildProject | null {
    const { selectedProjectId } = this.state.getSnapshot()
    return selectedProjectId ? this.getProject(selectedProjectId) : null
  }

  getEventLog(): UniversalBuildLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full queue, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  /** Organization-wide universal-build rollup. */
  getSummary(): UniversalBuilderSummary {
    const list = this.listProjects()
    const count = (status: UniversalBuildStatus): number =>
      list.filter((p) => p.status === status).length
    return {
      total: list.length,
      captured: count('captured'),
      planned: count('planned'),
      needsApproval: count('needs-approval'),
      approved: count('approved'),
      promptGenerated: count('prompt-generated'),
      inDevelopment: count('in-development'),
      completed: count('completed'),
      rejected: count('rejected'),
      pending: this.getPendingProjects().length
    }
  }

  /** Projects still working through planning / approval (Autopilot-readable). */
  getPendingProjects(): UniversalBuildProject[] {
    return this.listProjects().filter((p) => PENDING_STATUSES.has(p.status))
  }

  // --- selection -----------------------------------------------------------

  selectProject(projectId: string | null): UniversalBuilderOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (projectId && !snapshot.projects.some((p) => p.id === projectId)) {
      return { success: false, error: 'project not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedProjectId: projectId })
    this.events.emit('selection:changed', projectId)
    this.events.emit('snapshot:updated')
    return { success: true, data: projectId }
  }

  // --- create + plan + route ----------------------------------------------

  /**
   * Turn a CEO build command into a fully-planned UniversalBuildProject in one
   * safe step: classify the app type, generate the local plan (modules/screens/
   * data models), plan the AI-tool orchestration, generate the Claude Code
   * developer prompt, then route it into the development operating system (PM
   * Planner backlog + Approval Center when required + Development OS event). No
   * files are edited, no git runs, no external API is called.
   */
  submitBuildCommand(
    input: NewUniversalBuildInput
  ): UniversalBuilderOperationResult<UniversalBuildProject> {
    const raw = input.originalCommand.trim()
    if (!raw) return { success: false, error: 'command is empty' }
    const now = new Date().toISOString()

    // 1) Interpret — app type + risk.
    const classified = classifyAppType(raw)
    // 2) Plan — modules / screens / data models / integrations.
    const plan = buildPlan(classified.appType)
    const sprintPlan = buildSprintPlan(classified.appType, plan, (prefix) => this.nextId(prefix))
    const aiToolPlan = planTools(raw, classified.appType)
    const interpretedGoal = interpretGoal(raw, classified.appType)

    const routingLog: string[] = [
      `명령 캡처: "${raw}"`,
      `앱 타입 해석: ${classified.appType} (${classified.industry})`,
      `계획 생성: 모듈 ${plan.requiredModules.length} · 화면 ${plan.suggestedScreens.length} · 데이터 모델 ${plan.suggestedDataModels.length}`,
      `AI 도구 오케스트레이션: ${aiToolPlan.map((t) => t.toolName).join(', ')}`
    ]

    // 3) Generate the Claude Code developer prompt from the planned fields.
    const promptSource: PromptSource = {
      id: '',
      originalCommand: raw,
      projectName: classified.projectName,
      appType: classified.appType,
      industry: classified.industry,
      targetUsers: classified.targetUsers,
      interpretedGoal,
      requiredModules: plan.requiredModules,
      suggestedScreens: plan.suggestedScreens,
      suggestedDataModels: plan.suggestedDataModels,
      suggestedIntegrations: plan.suggestedIntegrations,
      aiToolPlan,
      sprintPlan,
      riskLevel: classified.riskLevel,
      approvalRequired: classified.approvalRequired,
      assumptions: plan.assumptions,
      requestedBy: input.requestedBy ?? 'CEO (Jarvis)',
      createdAt: now
    }
    const generatedDeveloperPrompt = generateDeveloperPrompt(promptSource)
    routingLog.push('Claude Code 개발자 프롬프트 생성')

    // 4) Route into the development operating system (safe, local).
    let pmPlanId: string | null = null
    const pm = pmRepository.addBacklogItem({
      title: `[App Builder] ${classified.projectName}`,
      description: `${interpretedGoal}\n\n원본 명령: ${raw}\n앱 타입: ${classified.appType}\n모듈: ${plan.requiredModules.join(', ')}`,
      priority: classified.approvalRequired ? 'P1' : 'P2'
    })
    if (pm.success && pm.data) {
      pmPlanId = pm.data.id
      routingLog.push(`PM Planner 백로그 생성: ${pm.data.id}`)
    }

    let approvalId: string | null = null
    if (classified.approvalRequired) {
      const approval = approvalRepository.createApproval({
        title: `[App Build] ${classified.projectName}`,
        description: interpretedGoal,
        category: 'product',
        requestedByWorkerId: 'jarvis',
        requestedByRole: 'Jarvis Universal App Builder',
        source: 'Jarvis Universal App Builder',
        priority: 'P1',
        riskLevel: classified.riskLevel === 'critical' ? 'critical' : 'high',
        impactSummary: `앱 타입: ${classified.appType} · 민감 도메인/외부 연동 가능 · 원본: ${raw}`
      })
      if (approval.success && approval.data) {
        approvalId = approval.data.approvalId
        routingLog.push(`Approval Center 요청 생성: ${approval.data.approvalId}`)
      }
    }

    const status: UniversalBuildStatus = classified.approvalRequired ? 'needs-approval' : 'prompt-generated'

    const project: UniversalBuildProject = {
      id: this.nextId('ubp'),
      originalCommand: raw,
      projectName: classified.projectName,
      appType: classified.appType,
      industry: classified.industry,
      targetUsers: classified.targetUsers,
      interpretedGoal,
      requiredModules: plan.requiredModules,
      suggestedScreens: plan.suggestedScreens,
      suggestedDataModels: plan.suggestedDataModels,
      suggestedIntegrations: plan.suggestedIntegrations,
      aiToolPlan,
      sprintPlan,
      riskLevel: classified.riskLevel,
      approvalRequired: classified.approvalRequired,
      status,
      createdAt: now,
      updatedAt: now,
      generatedDeveloperPrompt,
      assumptions: plan.assumptions,
      requestedBy: input.requestedBy ?? 'CEO (Jarvis)',
      pmPlanId,
      approvalId,
      routingLog
    }

    // 5) Development OS event (safe, non-intrusive record only).
    devOsRepository.recordEvent(
      `Jarvis Universal App Builder: "${project.projectName}" (${project.appType}) 계획 생성 · ${classified.approvalRequired ? 'CEO 승인 대기' : '프롬프트 준비 완료'}`
    )

    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        {
          ...snapshot,
          projects: [project, ...snapshot.projects],
          selectedProjectId: project.id
        },
        'prompt-generated',
        `App Builder 프로젝트 생성: ${project.projectName} (${project.appType})`
      )
    )
    this.events.emit('project:updated', project)

    return { success: true, data: project }
  }

  // --- shared mutation -----------------------------------------------------

  private updateProject(
    projectId: string,
    mutate: (p: UniversalBuildProject) => UniversalBuildProject,
    type: UniversalBuildLogType,
    message: (p: UniversalBuildProject) => string
  ): UniversalBuilderOperationResult<UniversalBuildProject> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.projects.findIndex((p) => p.id === projectId)
    if (index === -1) return { success: false, error: 'project not found' }
    const next: UniversalBuildProject = {
      ...mutate(snapshot.projects[index]),
      id: projectId,
      updatedAt: new Date().toISOString()
    }
    const projects = [...snapshot.projects]
    projects[index] = next
    this.commit(this.withLog({ ...snapshot, projects }, type, message(next)))
    this.events.emit('project:updated', next)
    return { success: true, data: next }
  }

  // --- lifecycle -----------------------------------------------------------

  setStatus(
    projectId: string,
    status: UniversalBuildStatus
  ): UniversalBuilderOperationResult<UniversalBuildProject> {
    return this.updateProject(
      projectId,
      (p) => ({ ...p, status }),
      'status-changed',
      (p) => `App Builder 상태 → ${status}: ${p.projectName}`
    )
  }

  /** Mark a project's prompt as sent to Claude Code (CEO pasted the prompt). */
  markSentToClaude(projectId: string): UniversalBuilderOperationResult<UniversalBuildProject> {
    return this.updateProject(
      projectId,
      (p) => ({ ...p, status: 'sent-to-claude' }),
      'status-changed',
      (p) => `App Builder 프롬프트 전달: ${p.projectName} → Claude Code`
    )
  }

  approveProject(projectId: string): UniversalBuilderOperationResult<UniversalBuildProject> {
    return this.updateProject(
      projectId,
      (p) => ({ ...p, status: 'approved' }),
      'approved',
      (p) => `App Builder 프로젝트 승인: ${p.projectName}`
    )
  }

  rejectProject(projectId: string): UniversalBuilderOperationResult<UniversalBuildProject> {
    return this.updateProject(
      projectId,
      (p) => ({ ...p, status: 'rejected' }),
      'rejected',
      (p) => `App Builder 프로젝트 반려: ${p.projectName}`
    )
  }

  // --- company integration -------------------------------------------------

  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Universal App Builder domain created — Jarvis can now turn CEO commands into structured app-building projects'
      )
    )
    devOsRepository.recordEvent(
      'Universal App Builder created — SJ OS는 더 이상 보험 전용이 아닙니다. 쇼핑몰/학원/병원/마케팅 등 어떤 비즈니스 시스템도 계획할 수 있습니다.'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Universal Builder queue back to empty. */
  resetDemoState(): UniversalBuilderOperationResult<UniversalBuilderSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Universal App Builder queue reset')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const universalBuilderRepository = new UniversalBuilderRepository()
