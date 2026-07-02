import CommandParser from './CommandParser'
import IntentRouter from './IntentRouter'
import ToolExecutor from './ToolExecutor'
import ConversationHistory from './ConversationHistory'
import IntentClassifier from './IntentClassifier'
import AnswerService from './AnswerService'
import ImplementationIntake, { WORKSPACE_LABEL } from './ImplementationIntake'
import type {
  JarvisClassification,
  JarvisExecutionResult,
  JarvisImplementationResult,
  JarvisState,
  ParsedCommand,
  ToolCall
} from './types'

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
        case 'briefing':
          result = this.handleAnswer('daily-briefing', classification, true)
          break
        case 'answer':
          result = this.handleAnswer(classification.intent, classification, false)
          break
        case 'navigation':
          result = this.handleNavigation(classification)
          break
        default:
          result = this.handleUnknown(command)
      }

      this.state.status = result.status
      this.state.response = result.response
      this.state.toolCalls = result.toolCalls
      this.state.answer = result.answer
      this.state.implementation = result.implementation
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
    const label = WORKSPACE_LABEL[classification.targetWorkspace] ?? classification.targetWorkspace
    return {
      mode: 'navigation',
      intent: 'navigate',
      response: `${label} 화면으로 이동합니다.`,
      toolCalls: [this.tool('navigate', `대상: ${label}`)],
      status: 'completed',
      navigationTarget: classification.navigationTarget,
      suggestedCommands: ['오늘 브리핑', '이번 달 실적']
    }
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
      response:
        '아직 이해하지 못한 명령입니다. 예: "오늘 브리핑", "이번 달 실적", "FC OS에 팀별 필터 추가해" 같은 명령을 사용해 보세요.',
      toolCalls: [],
      status: 'completed',
      suggestedCommands: ['오늘 브리핑', '오늘 FC 출근 현황', '이번 달 실적', 'FC OS에 팀별 필터 추가해']
    }
  }

  getParsedCommand(raw: string): ParsedCommand {
    return this.parser.parse(raw)
  }
}

export const jarvisService = new JarvisService()
export default JarvisService
