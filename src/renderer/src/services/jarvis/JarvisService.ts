import CommandParser from './CommandParser'
import IntentRouter from './IntentRouter'
import ToolExecutor from './ToolExecutor'
import ConversationHistory from './ConversationHistory'
import IntentClassifier from './IntentClassifier'
import AnswerService from './AnswerService'
import ImplementationIntake, { WORKSPACE_LABEL } from './ImplementationIntake'
import UniversalBuildIntake from './UniversalBuildIntake'
import ExternalActionService from './ExternalActionService'
import { jarvisGptBrainService } from './JarvisGptBrainService'
import type { GptMode } from './JarvisGptBrainService'
import type {
  JarvisAnswerResult,
  JarvisClassification,
  JarvisExecutionResult,
  JarvisExternalResult,
  JarvisGptResult,
  JarvisImplementationResult,
  JarvisSource,
  JarvisState,
  JarvisUniversalBuildResult,
  ParsedCommand,
  ToolCall
} from './types'

/** Per-target navigation copy for the Jarvis Command Router. */
interface NavInfo {
  summary: string
  nextAction: string
  suggested: string[]
}

const NAV_INFO: Record<string, NavInfo> = {
  autopilot: {
    summary:
      '오토파일럿 화면으로 이동할 수 있습니다. 여기서 회사 시작 또는 한 단계 실행으로 AI 회사 운영 루프를 돌릴 수 있습니다.',
    nextAction: '오토파일럿에서 회사 시작 또는 한 단계 실행',
    suggested: ['오늘 브리핑', '회사 시작', '자비스가 오토파일럿 실행하게 해']
  },
  company: {
    summary: '라이브 컴퍼니 화면으로 이동할 수 있습니다. 회사 전체 운영 현황과 최근 이벤트를 확인할 수 있습니다.',
    nextAction: '라이브 컴퍼니에서 오늘 운영 현황 확인',
    suggested: ['오늘 브리핑', '오늘 FC 출근 현황', '이번 달 실적']
  },
  'fc-os': {
    summary: 'FC OS 화면으로 이동할 수 있습니다. FC 출근/활동/월 실적을 확인하고 관리할 수 있습니다.',
    nextAction: 'FC OS에서 오늘 출근 현황 확인',
    suggested: ['오늘 FC 출근 현황', '이번 달 실적', 'FC OS에 팀별 필터 추가해']
  },
  approvals: {
    summary: '승인센터 화면으로 이동할 수 있습니다. 대기 중인 승인 요청을 검토/승인/반려할 수 있습니다.',
    nextAction: '승인센터에서 대기 중 요청 검토',
    suggested: ['오늘 브리핑', '이번 달 실적']
  },
  qa: {
    summary: 'QA 센터 화면으로 이동할 수 있습니다. 품질 점검과 QA 준비 상태를 확인할 수 있습니다.',
    nextAction: 'QA 센터에서 QA 준비 상태 확인',
    suggested: ['오늘 브리핑', 'DevOps']
  },
  release: {
    summary: '릴리즈센터 화면으로 이동할 수 있습니다. 릴리스 준비 상태와 배포 파이프라인을 확인할 수 있습니다.',
    nextAction: '릴리즈센터에서 릴리스 준비 상태 확인',
    suggested: ['오늘 브리핑', 'DevOps']
  },
  devops: {
    summary: 'DevOps 센터 화면으로 이동할 수 있습니다. 운영/배포 상태를 확인할 수 있습니다.',
    nextAction: 'DevOps 센터에서 운영 상태 확인',
    suggested: ['오늘 브리핑', 'QA 센터']
  }
}

/**
 * JarvisService — the CEO-facing control layer for SJ OS. It classifies a
 * command into a mode and dispatches:
 *  - answer: read local workspace data via AnswerService
 *  - implementation-request: raise + route a request via ImplementationIntake
 *  - navigation: surface a navigation target
 *  - briefing: cross-workspace daily summary
 *  - unknown: fall back to the legacy parser/executor (mock help)
 *
 * No AI/API call, no git, no file edits — implementation commands become safe,
 * structured requests routed through PM / Approval / DevOS / Autopilot.
 */
export class JarvisService {
  private parser = new CommandParser()
  private router = new IntentRouter()
  private executor = new ToolExecutor()
  private history = new ConversationHistory()
  private classifier = new IntentClassifier()
  private answers = new AnswerService()
  private intake = new ImplementationIntake()
  private universalBuild = new UniversalBuildIntake()
  private externals = new ExternalActionService()
  private gpt = jarvisGptBrainService

  private state: JarvisState = {
    isOpen: false,
    input: '',
    status: 'idle',
    mode: 'unknown',
    response: '자비스가 대기 중입니다.',
    toolCalls: [],
    history: [],
    recentCommands: [],
    suggestedCommands: []
  }

  open(): void {
    this.state.isOpen = true
  }

  close(): void {
    this.state.isOpen = false
  }

  toggle(): void {
    this.state.isOpen = !this.state.isOpen
  }

  getState(): JarvisState {
    return {
      ...this.state,
      history: this.history.getEntries(),
      recentCommands: this.history.getRecentCommands()
    }
  }

  updateInput(input: string): void {
    this.state.input = input
  }

  classify(raw: string): JarvisClassification {
    return this.classifier.classify(raw)
  }

  private tool(name: string, detail: string): ToolCall {
    return { id: `tool-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name, status: 'done', detail }
  }

  async executeCommand(raw: string): Promise<JarvisExecutionResult> {
    const command = raw.trim()
    this.state.status = 'thinking'
    this.state.response = '명령을 해석하는 중입니다…'
    this.state.toolCalls = []
    this.state.lastError = undefined
    this.state.answer = undefined
    this.state.implementation = undefined
    this.state.universalBuild = undefined
    this.state.external = undefined
    this.state.gpt = undefined
    this.state.source = undefined
    this.state.navigationTarget = null
    this.state.suggestedCommands = []
    this.history.addUserMessage(command)

    try {
      const classification = this.classifier.classify(command)
      this.state.mode = classification.mode
      this.state.status = 'running'

      let result: JarvisExecutionResult
      switch (classification.mode) {
        case 'implementation-request':
          result = this.handleImplementation(command, classification)
          break
        case 'universal-build':
          result = this.handleUniversalBuild(command)
          break
        case 'briefing':
          result = this.handleAnswer('daily-briefing', classification, true)
          break
        case 'answer':
          result = this.handleAnswer(classification.intent, classification, false)
          break
        case 'navigation':
          result = this.handleNavigation(classification)
          break
        case 'external-action':
          result = await this.handleExternal(classification)
          break
        case 'gpt':
          result = await this.handleGpt(command, classification)
          break
        default:
          // Local-first: if the command is not a deterministic local intent and
          // the GPT brain is enabled, fall back to the proxy-backed GPT brain.
          result = this.gpt.isEnabled() ? await this.askGpt(command) : this.handleUnknown(command)
      }

      this.state.status = result.status
      this.state.response = result.response
      this.state.toolCalls = result.toolCalls
      this.state.answer = result.answer
      this.state.implementation = result.implementation
      this.state.universalBuild = result.universalBuild
      this.state.external = result.external
      this.state.gpt = result.gpt
      this.state.source = result.source
      this.state.mode = result.mode
      this.state.navigationTarget = result.navigationTarget ?? null
      this.state.suggestedCommands = result.suggestedCommands ?? []
      this.history.addAssistantMessage(result.response, result.toolCalls)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'command failed'
      this.state.status = 'error'
      this.state.response = '명령 실행 중 문제가 발생했습니다.'
      this.state.lastError = message
      this.history.addAssistantMessage(this.state.response)
      return {
        mode: 'unknown',
        intent: 'error',
        response: this.state.response,
        toolCalls: [],
        status: 'error',
        error: message
      }
    }
  }

  private handleImplementation(
    command: string,
    classification: JarvisClassification
  ): JarvisExecutionResult {
    const request = this.intake.intake(command, classification)
    if (!request) {
      return {
        mode: 'implementation-request',
        intent: 'implementation-request',
        response: '구현 요청을 생성하지 못했습니다. 명령을 다시 확인해 주세요.',
        toolCalls: [],
        status: 'error'
      }
    }
    const impl: JarvisImplementationResult = {
      requestId: request.requestId,
      title: request.title,
      interpretedGoal: request.interpretedGoal,
      targetWorkspace: request.targetWorkspace,
      priority: request.priority,
      approvalRequired: request.approvalRequired,
      riskLevel: request.riskLevel,
      nextAction: request.nextAction,
      status: request.status,
      routeTarget: request.routeTarget,
      pmPlanId: request.pmPlanId,
      routingLog: request.routingLog,
      suggestedCommands: ['보험분석 기능 다음 스프린트로 올려', '오늘 브리핑', 'FC OS에 팀별 필터 추가해']
    }
    const label = WORKSPACE_LABEL[request.targetWorkspace] ?? request.targetWorkspace
    const toolCalls: ToolCall[] = [
      this.tool('createImplementationRequest', `요청 생성: ${request.title}`),
      this.tool('routeToPmPlanner', `PM 백로그: ${request.pmPlanId ?? '—'}`),
      this.tool(
        request.approvalRequired ? 'routeToApprovalCenter' : 'routeToAutopilot',
        `경로: ${request.routeTarget}`
      )
    ]
    const response = `구현 요청을 생성했습니다. 대상: ${label} · 우선순위 ${request.priority} · 위험도 ${request.riskLevel} · 상태 ${request.status} · 경로 ${request.routeTarget}. 다음 액션: ${request.nextAction}.`
    return {
      mode: 'implementation-request',
      intent: 'implementation-request',
      response,
      toolCalls,
      status: 'completed',
      implementation: impl,
      navigationTarget: null,
      suggestedCommands: impl.suggestedCommands
    }
  }

  /**
   * Handle a Universal App Builder command ("쇼핑몰 시스템 만들어"). Turns the
   * command into a structured, locally-planned build project (modules, screens,
   * data models, AI-tool orchestration plan, Claude Code-ready developer prompt)
   * and routes it into PM / Approval / DevOS. No files edited, no external API.
   */
  private handleUniversalBuild(command: string): JarvisExecutionResult {
    const project = this.universalBuild.intake(command)
    if (!project) {
      return {
        mode: 'universal-build',
        intent: 'universal-build-command',
        response: '앱 빌드 프로젝트를 생성하지 못했습니다. 명령을 다시 확인해 주세요.',
        toolCalls: [],
        status: 'error'
      }
    }
    const nextAction =
      '생성된 개발자 프롬프트를 복사해 Claude Code에 붙여넣어 개발을 진행하세요.'
    const universalBuild: JarvisUniversalBuildResult = {
      projectId: project.id,
      projectName: project.projectName,
      appType: project.appType,
      industry: project.industry,
      targetUsers: project.targetUsers,
      interpretedGoal: project.interpretedGoal,
      requiredModules: project.requiredModules,
      suggestedScreens: project.suggestedScreens,
      suggestedDataModels: project.suggestedDataModels,
      suggestedIntegrations: project.suggestedIntegrations,
      aiToolPlan: project.aiToolPlan,
      sprintPlan: project.sprintPlan,
      riskLevel: project.riskLevel,
      approvalRequired: project.approvalRequired,
      status: project.status,
      assumptions: project.assumptions,
      pmPlanId: project.pmPlanId,
      routingLog: project.routingLog,
      nextAction,
      generatedDeveloperPrompt: project.generatedDeveloperPrompt,
      suggestedCommands: [
        '쇼핑몰 시스템 만들어',
        '학원 관리 프로그램 만들어',
        'AI 영상 광고 제작 시스템 만들어',
        'Canva랑 Gamma랑 연결해서 제안서 자동 생성하게 해'
      ]
    }
    const toolCalls: ToolCall[] = [
      this.tool('classifyAppType', `앱 타입: ${project.appType} (${project.industry})`),
      this.tool('generateAppPlan', `모듈 ${project.requiredModules.length} · 화면 ${project.suggestedScreens.length} · 데이터 모델 ${project.suggestedDataModels.length}`),
      this.tool('planAiToolOrchestration', project.aiToolPlan.map((t) => t.toolName).join(', ')),
      this.tool('generateDeveloperPrompt', `Claude Code 프롬프트 생성 · ${project.generatedDeveloperPrompt.length}자`),
      this.tool('routeToPmPlanner', `PM 백로그: ${project.pmPlanId ?? '—'}`)
    ]
    const response = `Universal App Builder — "${project.projectName}" 프로젝트를 생성했습니다. 앱 타입 ${project.appType} · 위험도 ${project.riskLevel} · 상태 ${project.status}. ${project.approvalRequired ? 'CEO 승인이 필요합니다. ' : ''}개발자 프롬프트가 준비되었습니다. ${nextAction}`
    return {
      mode: 'universal-build',
      intent: 'universal-build-command',
      response,
      toolCalls,
      status: 'completed',
      universalBuild,
      navigationTarget: 'app-builder',
      suggestedCommands: universalBuild.suggestedCommands
    }
  }

  private handleAnswer(
    intent: string,
    classification: JarvisClassification,
    briefing: boolean
  ): JarvisExecutionResult {
    const answer = briefing ? this.answers.briefing() : this.answers.answer(intent)
    if (!answer) {
      return this.handleUnknown(classification.intent)
    }
    const toolCalls: ToolCall[] = [this.tool('readWorkspace', `${answer.sourceWorkspace} 데이터 조회`)]
    return {
      mode: briefing ? 'briefing' : 'answer',
      intent,
      response: answer.summary,
      toolCalls,
      status: 'completed',
      answer,
      navigationTarget: answer.navigationTarget,
      suggestedCommands: answer.suggestedCommands
    }
  }

  private handleNavigation(classification: JarvisClassification): JarvisExecutionResult {
    const ws = classification.targetWorkspace
    const label = WORKSPACE_LABEL[ws] ?? ws
    const info: NavInfo =
      NAV_INFO[ws] ??
      {
        summary: `${label} 화면으로 이동할 수 있습니다. 해당 워크스페이스에서 세부 현황을 확인하세요.`,
        nextAction: `${label}에서 세부 현황 확인`,
        suggested: ['오늘 브리핑', '이번 달 실적']
      }
    const commandUnderstood =
      classification.intent === 'autopilot-control' ? '오토파일럿 · 회사 운영' : `${label} 이동`
    const answer: JarvisAnswerResult = {
      commandUnderstood,
      sourceWorkspace: 'Jarvis Command Router',
      summary: info.summary,
      cards: [],
      recommendedNextAction: info.nextAction,
      navigationTarget: classification.navigationTarget,
      suggestedCommands: info.suggested
    }
    return {
      mode: 'navigation',
      intent: classification.intent,
      response: info.summary,
      toolCalls: [this.tool('navigate', `대상: ${label} (${classification.navigationTarget ?? '—'})`)],
      status: 'completed',
      answer,
      navigationTarget: classification.navigationTarget,
      suggestedCommands: info.suggested
    }
  }

  private async handleExternal(classification: JarvisClassification): Promise<JarvisExecutionResult> {
    const key = classification.externalKey
    const target = key ? this.externals.labelFor(key) : '외부 링크'
    const suggested = ['유튜브 켜줘', '네이버 열어줘', '구글 열어줘', 'SJ OS 깃허브 열어줘']
    if (!key) {
      return {
        mode: 'external-action',
        intent: 'external-open',
        response: '열 수 있는 승인된 외부 링크를 찾지 못했습니다.',
        toolCalls: [],
        status: 'error',
        suggestedCommands: suggested
      }
    }
    const outcome = await this.externals.open(key)
    const external: JarvisExternalResult = {
      commandUnderstood: `${target} 열기`,
      target,
      action: '승인된 외부 URL을 시스템 브라우저에서 엽니다',
      url: outcome.url ?? null,
      ok: outcome.ok,
      error: outcome.error
    }
    const response = outcome.ok
      ? `${target}을(를) 시스템 브라우저에서 열었습니다.`
      : `${target}을(를) 열지 못했습니다. ${outcome.error ?? '알 수 없는 오류입니다.'}`
    return {
      mode: 'external-action',
      intent: 'external-open',
      response,
      toolCalls: [this.tool('openExternal', `${target} · ${outcome.ok ? 'opened' : 'failed'}`)],
      status: outcome.ok ? 'completed' : 'error',
      external,
      suggestedCommands: suggested
    }
  }

  /**
   * Ask the proxy-backed GPT brain. Used as the fallback for non-deterministic
   * commands and by the UI's explicit "GPT에게 물어보기" action. When the brain
   * is disabled it returns a setup-guidance result (never throws).
   */
  async askGpt(command: string, mode?: GptMode): Promise<JarvisExecutionResult> {
    const brain = await this.gpt.ask(command, mode)
    const gpt: JarvisGptResult = {
      source: brain.source,
      mode: brain.mode,
      model: brain.model,
      disabled: brain.disabled,
      error: brain.error,
      canRetry: brain.canRetry
    }
    const toolCalls: ToolCall[] = brain.disabled
      ? []
      : [this.tool('callAiProxy', `POST /ai/chat · mode ${brain.mode} · ${brain.source}`)]
    const status = brain.success ? 'completed' : brain.disabled ? 'completed' : 'error'
    // 'disabled'/'fallback' → Fallback badge; 'gpt'/'error' → GPT badge.
    const source: JarvisSource =
      brain.source === 'disabled' || brain.source === 'fallback' ? 'fallback' : 'gpt'
    return {
      mode: 'gpt',
      intent: brain.mode,
      response: brain.answer,
      toolCalls,
      status,
      gpt,
      source,
      error: brain.error,
      suggestedCommands: [
        '오늘 조직 상황 브리핑 해줘',
        '이번 달 실적에서 문제점 분석해줘',
        '미활동 FC 관리 전략 짜줘',
        '우리 회사 앱 다음 기능 추천해줘'
      ]
    }
  }

  /** Map the classifier's GPT sub-mode string to a concrete GptMode. */
  private toGptMode(mode?: string): GptMode {
    switch (mode) {
      case 'business-briefing':
        return 'business-briefing'
      case 'implementation-planning':
        return 'implementation-planning'
      case 'strategy':
        return 'strategy'
      case 'data-question':
        return 'data-question'
      default:
        return 'general-assistant'
    }
  }

  /**
   * Handle a command classified as GPT-needed. When the brain is enabled it
   * calls the proxy; when disabled it returns a useful Korean fallback —
   * business briefings fall back to the local briefing summary so the CEO still
   * gets real local numbers.
   */
  private async handleGpt(
    command: string,
    classification: JarvisClassification
  ): Promise<JarvisExecutionResult> {
    const mode = this.toGptMode(classification.gptMode)
    if (this.gpt.isEnabled()) {
      return this.askGpt(command, mode)
    }

    // Disabled: business-briefing degrades to the local briefing (real numbers).
    if (mode === 'business-briefing') {
      const briefing = this.answers.briefing()
      const response = `${briefing.summary}\n\n[GPT proxy disabled fallback] 위 내용은 로컬 데이터 요약입니다. 심층 분석/전략 코멘트는 GPT 브레인을 활성화하면 제공됩니다.`
      return {
        mode: 'gpt',
        intent: 'business-briefing',
        response,
        toolCalls: [this.tool('localBriefingFallback', 'GPT 비활성화 · 로컬 브리핑 요약')],
        status: 'completed',
        gpt: { source: 'fallback', mode: 'business-briefing', disabled: true, canRetry: false },
        source: 'fallback',
        answer: briefing,
        navigationTarget: briefing.navigationTarget,
        suggestedCommands: briefing.suggestedCommands
      }
    }

    // Other GPT modes: return the labeled disabled-fallback guidance.
    return this.askGpt(command, mode)
  }

  private handleUnknown(command: string): JarvisExecutionResult {
    // Fall back to the legacy parser/executor for backwards compatibility.
    const parsed = this.parser.parse(command)
    if (parsed.intent !== 'unknown') {
      const routed = this.router.route(parsed)
      const legacy = this.executor.execute(routed)
      return {
        mode: 'answer',
        intent: legacy.intent,
        response: legacy.response,
        toolCalls: legacy.toolCalls,
        status: legacy.status
      }
    }
    return {
      mode: 'unknown',
      intent: 'unknown',
      response: [
        '아직 이해하지 못한 명령입니다. 아래 예시를 사용해 보세요.',
        '• 업무 질문: "오늘 브리핑", "오늘 FC 출근 현황", "이번 달 실적", "미완료 활동", "클로징 예정 고객"',
        '• 화면 이동: "FC OS", "고객 워크스페이스", "오토파일럿 열어줘", "라이브 컴퍼니", "승인센터"',
        '• 회사 운영: "회사 시작", "운영 루프 시작"',
        '• 구현 요청: "FC OS에 팀별 필터 추가해", "고객 워크스페이스 개선해", "자비스가 오토파일럿 실행하게 해"'
      ].join('\n'),
      toolCalls: [],
      status: 'completed',
      source: 'local',
      gpt: {
        source: 'disabled',
        mode: 'unknown-fallback',
        disabled: true,
        canRetry: false
      },
      suggestedCommands: [
        '오늘 브리핑',
        'FC OS',
        '오토파일럿 열어줘',
        '회사 시작',
        'FC OS에 팀별 필터 추가해',
        '자비스가 오토파일럿 실행하게 해'
      ]
    }
  }

  getParsedCommand(raw: string): ParsedCommand {
    return this.parser.parse(raw)
  }
}

export const jarvisService = new JarvisService()
export default JarvisService
