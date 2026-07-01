import CommandParser from './CommandParser'
import IntentRouter from './IntentRouter'
import ToolExecutor from './ToolExecutor'
import ConversationHistory from './ConversationHistory'
import type { JarvisExecutionResult, JarvisState, ParsedCommand } from './types'

export class JarvisService {
  private parser = new CommandParser()
  private router = new IntentRouter()
  private executor = new ToolExecutor()
  private history = new ConversationHistory()

  private state: JarvisState = {
    isOpen: false,
    input: '',
    status: 'idle',
    response: '자비스가 대기 중입니다.',
    toolCalls: [],
    history: [],
    recentCommands: []
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

  async executeCommand(raw: string): Promise<JarvisExecutionResult> {
    const parsed = this.parser.parse(raw)
    this.state.status = 'thinking'
    this.state.response = '명령을 해석하는 중입니다…'
    this.state.toolCalls = []
    this.state.lastError = undefined
    this.history.addUserMessage(raw)

    try {
      const routed = this.router.route(parsed)
      this.state.status = 'running'
      this.state.response = `${routed.description}`
      const result = this.executor.execute(routed)
      this.state.status = result.status
      this.state.response = result.response
      this.state.toolCalls = result.toolCalls
      this.history.addAssistantMessage(result.response, result.toolCalls)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'command failed'
      this.state.status = 'error'
      this.state.response = '명령 실행 중 문제가 발생했습니다.'
      this.state.lastError = message
      this.history.addAssistantMessage(this.state.response)
      return {
        intent: parsed.intent,
        response: this.state.response,
        toolCalls: [],
        status: 'error',
        error: message
      }
    }
  }

  getParsedCommand(raw: string): ParsedCommand {
    return this.parser.parse(raw)
  }
}

export const jarvisService = new JarvisService()
export default JarvisService
